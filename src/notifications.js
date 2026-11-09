const nodemailer = require("nodemailer");

const channel = (process.env.NOTIFICATION_CHANNEL || "none").trim().toLowerCase();
const allowedChannels = new Set(["none", "email", "sms", "both"]);

function validateNotificationConfig() {
  if (!allowedChannels.has(channel)) {
    throw new Error("NOTIFICATION_CHANNEL must be email, sms, both, or none.");
  }
  if ((channel === "email" || channel === "both") &&
      (!process.env.ORDER_ALERT_EMAIL || !process.env.SMTP_HOST || !process.env.SMTP_FROM)) {
    throw new Error("Email alerts need ORDER_ALERT_EMAIL, SMTP_HOST, and SMTP_FROM.");
  }
  if ((channel === "sms" || channel === "both") &&
      (!process.env.ORDER_ALERT_PHONE || !process.env.TWILIO_ACCOUNT_SID ||
       !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_PHONE)) {
    throw new Error("SMS alerts need ORDER_ALERT_PHONE and all TWILIO_* settings.");
  }
}

function formatOrderMessage(order) {
  const itemLines = order.items
    .map((item) => `${item.quantity} x ${item.product_name} — €${(item.unit_price_cents / 100).toFixed(2)}`)
    .join("\n");
  const fulfillment = order.fulfillment === "delivery"
    ? `Delivery to: ${order.delivery_address}`
    : "Pickup";

  return [
    `New Laugh-Wing order #${order.id}`,
    `Customer: ${order.customer_name}`,
    `Contact: ${order.customer_phone || order.customer_email}`,
    fulfillment,
    "",
    itemLines,
    "",
    `Total: €${(order.total_cents / 100).toFixed(2)}`,
    order.notes ? `Note: ${order.notes}` : "",
  ].filter(Boolean).join("\n");
}

async function sendEmail(order, message) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.ORDER_ALERT_EMAIL,
    subject: `New Laugh-Wing order #${order.id}`,
    text: message,
  });
}

async function sendSms(message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const credentials = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const body = new URLSearchParams({
    To: process.env.ORDER_ALERT_PHONE,
    From: process.env.TWILIO_FROM_PHONE,
    Body: message.slice(0, 1500),
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`SMS provider returned HTTP ${response.status}.`);
  }
}

async function sendOrderNotifications(order) {
  if (channel === "none") {
    return "disabled";
  }

  const message = formatOrderMessage(order);
  const sends = [];
  if (channel === "email" || channel === "both") {
    sends.push(sendEmail(order, message));
  }
  if (channel === "sms" || channel === "both") {
    sends.push(sendSms(message));
  }

  const results = await Promise.allSettled(sends);
  const failures = results.filter((result) => result.status === "rejected");
  for (const failure of failures) {
    console.error("Order notification delivery failed:", failure.reason.message);
  }
  if (failures.length === 0) {
    return "sent";
  }
  return failures.length === results.length ? "failed" : "partial";
}

module.exports = { validateNotificationConfig, sendOrderNotifications };
