/** Calendar-day waits for reply-to-close (after our outbound LinkedIn sends). */

/** After our main reply (or any send from **Reply Draft**), wait before first follow-up. */
export const REPLY_CLOSE_DAYS_AFTER_OUR_SEND = 3;

/** After **Follow-up 1** is sent, wait before **Follow-up 2** if still no reply. */
export const REPLY_CLOSE_DAYS_AFTER_FIRST_FOLLOWUP = 7;

/** After **Follow-up 2** is sent, final grace window before parking in **Keep in touch** if still quiet. */
export const REPLY_CLOSE_DAYS_AFTER_SECOND_FOLLOWUP = 7;
