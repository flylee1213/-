import { createClient } from '@supabase/supabase-js';

// Configuration provided by user
// We use the hardcoded values to prevent "Cannot read properties of undefined" errors 
// related to missing environment variables in the browser runtime.
const supabaseUrl = 'https://zmtmuirsweiyfnbupljg.supabase.co';
const supabaseKey = 'sb_publishable_lmEOJnCqituS5lPfNdm1NQ_oZzh53eG';

export const supabase = createClient(supabaseUrl, supabaseKey);