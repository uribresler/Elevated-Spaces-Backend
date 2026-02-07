import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

// SendGrid SMTP Configuration (use environment variables)
const SMTP_HOST = process.env.SMTP_HOST || "smtp.sendgrid.net";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS!; // SendGrid API key from environment

// Create a reusable transporter object for SendGrid
const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true, // false for port 587 (TLS)
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
    },
    // Add connection timeout and additional options
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 5000,
    socketTimeout: 30000, // 30 seconds
    logger: true, // Enable logging
    debug: process.env.NODE_ENV !== 'production', // Debug in dev only
});

// Email properties interface
export interface EmailProps {
    from: string;
    senderName: string;
    to: string;
    subject: string;
    text: string;
    html?: string; // optional HTML content
    replyTo?: string;
    senderEmail?: string;
}

// Send email function
export const sendEmail = async ({
    from,
    senderName,
    to,
    subject,
    text,
    html,
    replyTo,
    senderEmail,
}: EmailProps) => {
    // SendGrid requires verified sender email
    const verifiedSender = "saifullahahmed380@gmail.com"; // Your verified SendGrid sender
    const mailOptions = {
        from: `"${senderName}" <${verifiedSender}>`, // Use verified sender
        replyTo: replyTo || from, // Original sender as reply-to
        to,
        subject,
        text,
        html,
    };

    return new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
                console.error("Error sending email:", err);
                reject(err);
            } else {
                console.log("Email sent:", info.messageId);
                resolve(info);
            }
        });
    });
};

// const { MailtrapClient } = require("mailtrap");

// const MAILTRAP_TOKEN = process.env.MAILTRAP_TOKEN;

// const client = new MailtrapClient({
//     token: MAILTRAP_TOKEN,
// });

// interface emailProps {
//     from: string;
//     senderName: string;
//     to: string;
//     subject: string;
//     text: string;
//     category?: string
// }

// export const sendEmail = ({
//     from,
//     senderName,
//     to,
//     subject,
//     text,
//     category,
// }: emailProps) => {
//     const sender = {
//         email: from,
//         name: senderName,
//     };

//     const recipients = [{ email: to }];

//     return client.send({
//         from: sender,
//         to: recipients,
//         subject,
//         text,
//         category,
//     });
// };



// const sender = {
//     email: "hello@elevatespacesai.com",
//     name: "Mailtrap Test",
// };
// const recipients = [
//     {
//         email: "saifullahahmed380@gmail.com",
//     }
// ];

// client
//     .send({
//         from: sender,
//         to: recipients,
//         subject: "You are awesome!",
//         text: "Congrats for sending test email with Mailtrap!",
//         category: "Integration Test",
//     })
//     .then(console.log, console.error);