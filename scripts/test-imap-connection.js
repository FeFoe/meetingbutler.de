#!/usr/bin/env node
/**
 * Quick IMAP connection test
 */
const { ImapFlow } = require('imapflow');
require('dotenv').config();

async function main() {
  console.log('Testing IMAP connection to', process.env.IMAP_HOST);

  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || '993'),
    secure: process.env.IMAP_SECURE === 'true',
    auth: {
      user: process.env.IMAP_ADMIN_USER,
      pass: process.env.IMAP_ADMIN_PASSWORD,
    },
    logger: false,
  });

  try {
    await client.connect();
    console.log('✓ Connected to IMAP server');

    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { messages: true, unseen: true });
      console.log('✓ INBOX status:', status);

      let count = 0;
      for await (const msg of client.fetch({ seen: false }, { uid: true, envelope: true })) {
        console.log(`  Unseen: [${msg.uid}] ${msg.envelope?.subject?.slice(0, 60)}`);
        count++;
        if (count >= 5) { console.log('  (showing max 5)'); break; }
      }
      if (count === 0) console.log('  No unseen messages.');
    } finally {
      lock.release();
    }

    await client.logout();
    console.log('✓ Disconnected cleanly');
  } catch (err) {
    console.error('✗ IMAP error:', err.message);
    process.exit(1);
  }
}

main();
