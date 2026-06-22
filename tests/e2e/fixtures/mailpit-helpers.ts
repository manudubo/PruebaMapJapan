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
  const MAX_ATTEMPTS = 20;
  const DELAY_MS = 500;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const data = await res.json() as MailpitListResponse;
    if (data.messages?.length) {
      const msgId = data.messages[0].ID;
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msgId}`);
      const msg = await msgRes.json() as MailpitMessageBody;
      const match = msg.Text.match(/(\d{6})/);
      if (match) return match[1];
    }
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
  throw new Error(`fetchLatestOtp: no OTP found after ${MAX_ATTEMPTS} attempts (${MAX_ATTEMPTS * DELAY_MS}ms)`);
}
