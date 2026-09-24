// The public half of the key the alarm's pushes are signed with. The browser
// subscribes with it (alerts.svelte.ts); the pipeline signs with the private
// half, the VAPID_PRIVATE_KEY secret (server/pipeline/alerts.ts).
export const VAPID_PUBLIC_KEY = 'BFPmVAK6WB-RAiVBKm1mPqkmTz4HI3RG7TFVm6MpJPut3lm1ZnzlZIsA2_ckfUeZtTpBU_azmV0rkfPomUM-acc'
