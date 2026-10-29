import { createClient } from '@supabase/supabase-js'

// VITE_* names are what a deployed build can bake in; NEXT_PUBLIC_* names also work locally.
const url = (import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string | undefined

/**
 * Browser Supabase client (publishable key). It can only READ wallets and ledger entries:
 * row-level security blocks every browser write, and the custody server performs all updates.
 */
export const supabase = url && anonKey ? createClient(url, anonKey, { auth: { persistSession: false } }) : null
