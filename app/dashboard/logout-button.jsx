'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    const confirmed = confirm('로그아웃 하시겠습니까?');
    if (!confirmed) return;

    const { error } = await supabase.auth.signOut();
    if (error) {
      alert('로그아웃 실패: ' + error.message);
      return;
    }

    router.push('/login');
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      className="text-sm text-gray-600 hover:text-gray-900 transition"
    >
      로그아웃
    </button>
  );
}