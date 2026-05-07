// 브라우저용 Supabase 클라이언트
// 사용자가 브라우저에서 Supabase와 대화할 때 사용

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
}