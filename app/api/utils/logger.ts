import { ClassifiedMessage, MessageParameters } from "@/app/types/api";

export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

type Metadata = {
  path?: string;
  ticketId?: string;
  orderNumber?: string;
  error?: string;
  intent?: string;
  parameters?: MessageParameters;
  originalMessage?: string;
  [key: string]: string | number | boolean | undefined | MessageParameters;
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  intent?: string;
  parameters?: MessageParameters;
  error?: Error;
  metadata?: Metadata;
}

class Logger {
  private static instance: Logger;
  private isDevelopment: boolean;

  private constructor() {
    this.isDevelopment = process.env.NODE_ENV === "development";
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatLog(entry: LogEntry): string {
    const baseLog = {
      timestamp: entry.timestamp,
      level: entry.level,
      message: entry.message,
      ...(entry.requestId && { requestId: entry.requestId }),
      ...(entry.intent && { intent: entry.intent }),
      ...(entry.parameters && { parameters: entry.parameters }),
      ...(entry.error && {
        error: {
          name: entry.error.name,
          message: entry.error.message,
          stack: this.isDevelopment ? entry.error.stack : undefined,
        },
      }),
      ...(entry.metadata && { metadata: entry.metadata }),
    };

    return JSON.stringify(baseLog);
  }

  public info(message: string, metadata?: Metadata, requestId?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message,
      requestId,
      metadata,
    };
    console.log(this.formatLog(entry));
  }

  public warn(message: string, metadata?: Metadata, requestId?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      message,
      requestId,
      metadata,
    };
    console.warn(this.formatLog(entry));
  }

  public error(
    message: string,
    error?: Error,
    metadata?: Metadata,
    requestId?: string
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      message,
      requestId,
      error,
      metadata,
    };
    console.error(this.formatLog(entry));
  }

  public debug(message: string, metadata?: Metadata, requestId?: string): void {
    if (this.isDevelopment) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: LogLevel.DEBUG,
        message,
        requestId,
        metadata,
      };
      console.debug(this.formatLog(entry));
    }
  }

  public logIntentClassification(
    message: string,
    classification: ClassifiedMessage,
    requestId?: string
  ): void {
    this.info(
      "Intent classification completed",
      {
        originalMessage: message,
        intent: classification.intent,
        parameters: classification.parameters,
        language: classification.language,
      },
      requestId
    );
  }
}

export const logger = Logger.getInstance();
