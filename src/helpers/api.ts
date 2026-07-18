import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import os from 'os';
import { logger } from './logger.js';
import { sessionStore } from '../store/sessionStore.js';
import { env } from '../config/env.js';

let lastRequestTime = 0;
const MIN_GAP_MS = 1000;
let queueChain: Promise<any> = Promise.resolve();

let cachedPublicIp = '106.193.147.98'; // fallback
let cachedLocalIp = '192.168.1.1'; // fallback
let cachedMacAddress = 'fe80::216:3eff:fe0f:1105'; // fallback
let ipFetched = false;

// Populate local network interface info immediately on startup
const getLocalNetworkInfo = () => {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) {
          cachedLocalIp = alias.address;
          if (alias.mac && alias.mac !== '00:00:00:00:00:00') {
            cachedMacAddress = alias.mac;
          }
          return;
        }
      }
    }
  } catch (err: any) {
    logger.warn(`Failed to fetch local network interfaces: ${err.message}`);
  }
};
getLocalNetworkInfo();

// Fetch public IP dynamically
const fetchPublicIp = async (): Promise<string> => {
  if (ipFetched) return cachedPublicIp;
  try {
    const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    if (response.data && response.data.ip) {
      cachedPublicIp = response.data.ip;
      ipFetched = true;
      logger.info(`Resolved real VM public IP: ${cachedPublicIp}`);
    }
  } catch (err: any) {
    logger.warn(
      `Failed to fetch dynamic public IP: ${err.message}. Using fallback: ${cachedPublicIp}`,
    );
  }
  return cachedPublicIp;
};

// Synchronizes and throttles all API calls to ensure at least 1000ms gap between each start
const throttle = async (): Promise<void> => {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_GAP_MS) {
    const delay = MIN_GAP_MS - timeSinceLast;
    lastRequestTime = now + delay;
    await new Promise((resolve) => setTimeout(resolve, delay));
  } else {
    lastRequestTime = now;
  }
};

const executeWithQueue = <T>(requestFn: () => Promise<T>): Promise<T> => {
  const promise = queueChain.then(async () => {
    await throttle();
    return requestFn();
  });
  // Prevent failures from breaking the queue chain
  queueChain = promise.catch(() => {});
  return promise;
};

// Retry with exponential backoff sequence: 2s, 4s, 8s, 16s, 24s (capped at 24s)
export const requestWithRetry = async <T>(requestFn: () => Promise<T>): Promise<T> => {
  const DELAY_SEQUENCE = [2000, 4000, 8000, 16000, 24000];
  let attempt = 1;
  const maxAttempts = 5;

  while (true) {
    try {
      return await requestFn();
    } catch (error: any) {
      if (attempt < maxAttempts) {
        const delay = DELAY_SEQUENCE[attempt - 1] || 24000;
        logger.warn(
          `API request failed: ${error.message}. Retrying in ${delay / 1000}s... (Attempt ${attempt}/${maxAttempts})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
      } else {
        logger.error(
          `API request failed after ${maxAttempts} attempts. Propagating final error: ${error.message}`,
        );
        throw error;
      }
    }
  }
};

// Generic axios request wrapper
export const apiRequest = async <T = any>(
  config: AxiosRequestConfig,
  skipRetry = false,
): Promise<T> => {
  const executeCall = async (): Promise<T> => {
    const session = sessionStore.getSession();
    const publicIp = await fetchPublicIp();

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': cachedLocalIp,
      'X-ClientPublicIP': publicIp,
      'X-MACaddress': cachedMacAddress,
      'X-PrivateKey': env.API_KEY,
      ...(config.headers || {}),
    } as any;

    if (session.jwtToken) {
      headers['Authorization'] = `Bearer ${session.jwtToken}`;
    }

    try {
      const response: AxiosResponse<T> = await axios({
        timeout: 8000,
        ...config,
        headers,
      });

      // Check for application level status error in SmartAPI
      const data = response.data as any;
      if (data && data.status === false) {
        throw new Error(data.message || 'SmartAPI error status false');
      }

      return data;
    } catch (error: any) {
      if (
        error.code === 'ECONNABORTED' ||
        error.message?.includes('timeout') ||
        error.message?.includes('ETIMEDOUT')
      ) {
        logger.error(`API Request timed out: ${config.method || 'GET'} ${config.url}`);
        try {
          const { sendAlert } = await import('../notifier.js');
          await sendAlert(
            `⚠️ <b>API Request Timeout!</b>\n<code>${config.method || 'GET'} ${config.url}</code> timed out after 8000ms.`,
          );
        } catch (alertErr: any) {
          logger.error(`Failed to send timeout alert: ${alertErr.message}`);
        }
      }
      throw error;
    }
  };

  return executeWithQueue(() => (skipRetry ? executeCall() : requestWithRetry(executeCall)));
};
