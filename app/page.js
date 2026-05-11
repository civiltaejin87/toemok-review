import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 로그인 상태에 따라 자동 라우팅
  if (user) {
    redirect('/dashboard');
  } else {
    redirect('/login');
  }
}
