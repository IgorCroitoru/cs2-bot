import winston from "winston"
const { format, transports } = winston;

// Define the log format with colors and timestamps
const logFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level}]: ${message}${stack ? '\n' + stack : ''}`;
  }),
);

// Create a Winston logger
export const logger = winston.createLogger({
  level: 'debug', // Set the log level as needed (info, warn, error, etc.)
  format: logFormat,
  transports: [
    new transports.Console() ,
    // new transports.File({ filename: 'error.log', level: 'error' }),
    // new transports.File({ filename: 'combined.log' })
  ]
});

