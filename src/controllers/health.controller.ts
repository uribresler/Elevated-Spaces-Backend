import { Request, Response } from 'express';
import nodemailer from 'nodemailer';

export const healthCheck = (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'API is healthy' });
};

export const testSMTP = async (req: Request, res: Response) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000,
    });

    // Verify connection
    await transporter.verify();
    
    res.status(200).json({ 
      success: true, 
      message: 'SMTP connection successful',
      config: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        user: process.env.SMTP_USER,
      }
    });
  } catch (error: any) {
    console.error('SMTP Test Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'SMTP connection failed',
      error: error.message,
      code: error.code,
      command: error.command,
    });
  }
};
