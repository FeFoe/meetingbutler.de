#!/usr/bin/env node
/**
 * Move specified UIDs from Meetingbutler/Bearbeitet back to INBOX
 * so the poller picks them up again on the next poll cycle.
 *
 * Usage:
 *   node scripts/requeue-uids.js 18 19
 */
require('dotenv').config();
const { ImapFlow } = require('imapflow');

const FOLDER_PROCESSED = 'Meetingbutler/Bearbeitet';

async function main() {
  const uids = process.argv.slice(2).map(Number).filter(Boolean);
  if (uids.length === 0) {
    console.error('Usage: node scripts/requeue-uids.js <uid1> [uid2 ...]');
    process.exit(1);
  }

  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || '993', 10),
    secure: process.env.IMAP_SECURE !== 'false',
    auth: {
      user: process.env.IMAP_MEETINGS_USER,
      pass: process.env.IMAP_MEETINGS_PASSWORD,
    },
    logger: false,
  });

  await client.connect();
  console.log(`Connected. Moving UIDs [${uids.join(', ')}] from ${FOLDER_PROCESSED} → INBOX`);

  const lock = await client.getMailboxLock(FOLDER_PROCESSED);
  try {
    for (const uid of uids) {
      try {
        await client.messageFlagsRemove({ uid }, ['\\Seen'], { uid: true });
        await client.messageMove({ uid }, 'INBOX', { uid: true });
        console.log(`  uid=${uid}: moved to INBOX`);
      } catch (err) {
        console.error(`  uid=${uid}: failed — ${err.message}`);
      }
    }
  } finally {
    lock.release();
  }

  await client.logout();
  console.log('Done. Messages will be re-processed on the next poll cycle (within 30s).');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
