const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitMessage {
  ID: string;
}

interface MailpitListResponse {
  messages: MailpitMessage[];
}

interface MailpitMessageBody {
  Text: string;
}

export async function purgeInbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

export async function fetchLatestOtp(): Promise<string> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  const data = await res.json() as MailpitListResponse;
  if (!data.messages?.length) throw new Error('No messages in Mailpit inbox');
  const msgId = data.messages[0].ID;
  const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msgId}`);
  const msg = await msgRes.json() as MailpitMessageBody;
  const match = msg.Text.match(/(\d{6})/);
  if (!match) throw new Error('No 6-digit OTP found in message body');
  return match[1];
}
