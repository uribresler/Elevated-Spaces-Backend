import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

// Load SMTP credentials from environment
const SMTP_HOST = process.env.SMTP_HOST!;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER!;
const SMTP_PASS = process.env.SMTP_PASS!;

// Create a reusable transporter object
const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for other ports
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
    },
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
    const effectiveSenderEmail = senderEmail || SMTP_USER;
    const mailOptions = {
        from: `"${senderName}" <${from}>`,
        sender: `"Elevate Spaces" <${effectiveSenderEmail}>`,
        replyTo: replyTo || from,
        to,
        subject,
        text,
        html,
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log("Email sent:", info.messageId);
        return info;
    } catch (err) {
        console.error("Error sending email:", err);
        throw err;
    }
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