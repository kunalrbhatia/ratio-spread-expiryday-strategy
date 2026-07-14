import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { logger } from './logger.js';
import { sessionStore } from '../store/sessionStore.js';
import { env } from '../config/env.js';

let lastRequestTime = 0;
const MIN_GAP_MS = 1000;
let queueChain: Promise<any> = Promise.resolve();

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

// Retry with exponential backoff
const requestWithRetry = async <T>(
  requestFn: () => Promise<T>,
  retries = 3,
  delay = 1000,
): Promise<T> => {
  try {
    return await requestFn();
  } catch (error: any) {
    if (retries > 0) {
      logger.warn(
        `API request failed: ${error.message}. Retrying in ${delay}ms... (Retries left: ${retries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return requestWithRetry(requestFn, retries - 1, delay * 2);
    }
    throw error;
  }
};

// Generic axios request wrapper
export const apiRequest = async <T = any>(config: AxiosRequestConfig): Promise<T> => {
  const executeCall = async (): Promise<T> => {
    const session = sessionStore.getSession();
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '192.168.1.1',
      'X-ClientPublicIP': '106.193.147.98',
      'X-MACaddress': 'fe80::216:3eff:fe0f:1105',
      'X-PrivateKey': env.API_KEY,
      ...(config.headers || {}),
    } as any;

    if (session.jwtToken) {
      headers['Authorization'] = `Bearer ${session.jwtToken}`;
    }

    const response: AxiosResponse<T> = await axios({
      ...config,
      headers,
    });

    // Check for application level status error in SmartAPI
    const data = response.data as any;
    if (data && data.status === false) {
      throw new Error(data.message || 'SmartAPI error status false');
    }

    return data;
  };

  return executeWithQueue(() => requestWithRetry(executeCall));
};
