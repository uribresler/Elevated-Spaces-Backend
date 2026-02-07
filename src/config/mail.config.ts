import dotenv from "dotenv";
import sgMail from "@sendgrid/mail";
dotenv.config();

// SendGrid HTTP API Configuration (use environment variables)
const SENDGRID_API_KEY = process.env.SMTP_PASS || process.env.SENDGRID_API_KEY;

if (!SENDGRID_API_KEY) {
    throw new Error("SendGrid API key is missing. Set SMTP_PASS or SENDGRID_API_KEY.");
}

sgMail.setApiKey(SENDGRID_API_KEY);

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
    const msg = {
        to,
        from: {
            email: verifiedSender,
            name: senderName,
        },
        replyTo: replyTo || from,
        subject,
        text,
        html,
    };

    try {
        const [response] = await sgMail.send(msg);
        console.log("Email sent:", response.headers["x-message-id"]);
        return response;
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