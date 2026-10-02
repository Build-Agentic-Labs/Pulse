import { verifyArchive } from './archive.mjs';
const file = process.argv[2];
if (!file) throw new Error('Usage: PULSE_BACKUP_PASSWORD=… node scripts/backup/verify.mjs file.pulsebackup');
const password = process.env.PULSE_BACKUP_PASSWORD;
delete process.env.PULSE_BACKUP_PASSWORD;
const result = await verifyArchive(file, password);
console.log(JSON.stringify(result));
