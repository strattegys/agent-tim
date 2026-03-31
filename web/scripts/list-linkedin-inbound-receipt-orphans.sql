-- Rows where dedupe was claimed but processing never finalized (crash / timeout / pre-finally code).
-- After migrate-linkedin-inbound-receipt-outcome.sql. Run: npm run db:exec -- scripts/list-linkedin-inbound-receipt-orphans.sql

SELECT id,
       "eventKind",
       "personId",
       "senderDisplayName",
       "chatId",
       LEFT("unipileMessageId", 72) AS message_id_snip,
       "createdAt"
FROM "_linkedin_inbound_receipt"
WHERE "processedAt" IS NULL
  AND "createdAt" < NOW() - INTERVAL '20 minutes'
ORDER BY "createdAt" ASC
LIMIT 100;
