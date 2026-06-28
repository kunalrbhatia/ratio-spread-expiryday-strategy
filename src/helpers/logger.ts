import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const getISTTimestamp = (): string => {
  return new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
  });
};

const customFormat = winston.format.combine(
  winston.format.printf(({ level, message }) => {
    return `[${getISTTimestamp()}] [${level.toUpperCase()}]: ${message}`;
  }),
);

export const logger = winston.createLogger({
  level: 'info',
  format: customFormat,
  transports: [
    new winston.transports.Console(),
    new DailyRotateFile({
      dirname: 'logs',
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
    }),
  ],
});
