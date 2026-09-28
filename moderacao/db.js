// The panel's one connection to the Qoleto database.
//
// The key is the publishable one, the same the app ships: every read and
// every change the panel makes goes through functions that check the
// moderator list on the server, so the key alone opens nothing.
//
// Kept apart from panel.js so the design can be previewed with sample data
// (a stand-in db.js with the same shape) without touching the panel itself.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://dshqzppwbzdeumwlkpfi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FcuGYckk4FyG9kR9e5iBCQ_NGY_O0Fg';

export const db = createClient(SUPABASE_URL, SUPABASE_KEY);
export const DEMO = false;

/** The sunlit vineyard behind the sign-in, from the app's own storage. */
export const ART_PHOTO =
  `${SUPABASE_URL}/storage/v1/render/image/public/producer-photos/lab/frutas.jpg?width=1600&quality=75`;
