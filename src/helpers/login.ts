import { authenticator } from 'otplib';
import { apiRequest } from './api.js';
import { env } from '../config/env.js';
import { sessionStore } from '../store/sessionStore.js';
import { logger } from './logger.js';
import { CONSTANTS } from './constants.js';

export const generateTOTP = (secret: string): string => {
  return authenticator.generate(secret);
};

export const loginToSmartAPI = async (): Promise<boolean> => {
  try {
    const totp = generateTOTP(env.CLIENT_TOTP_PIN);
    logger.info(`Generated TOTP for login`);

    const response = await apiRequest({
      method: 'POST',
      url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/auth/angelone/vas/v1/loginRule`,
      data: {
        clientcode: env.CLIENT_CODE,
        password: env.CLIENT_PIN,
        totp,
      },
    });

    if (response.status === true && response.data) {
      const { jwtToken, feedToken, refreshToken } = response.data;
      sessionStore.setSession(jwtToken, feedToken, refreshToken);
      logger.info('Successfully authenticated with SmartAPI and stored session tokens.');
      return true;
    }

    throw new Error(response.message || 'SmartAPI authentication failed');
  } catch (error: any) {
    logger.error(`SmartAPI login failed: ${error.message}`);
    return false;
  }
};
