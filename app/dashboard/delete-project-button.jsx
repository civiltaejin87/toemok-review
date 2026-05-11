'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function DeleteProjectButton({ projectId, projectName }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  const handleDelete = async (e) => {
    // Link 클릭 이벤트 차단 (카드 클릭으로 인한 페이지 이동 방지)
    e.preventDefault();
    e.stopPropagation();

    const confirmed = window.confirm(
      `정말 "${projectName}" 프로젝트를 삭제하시겠습니까?\n\n⚠️ 다음 데이터가 모두 삭제됩니다:\n  • 업로드된 모든 파일 (documents)\n  • AI 검토 결과 (reviews)\n  • 프로젝트 정보\n\n이 작업은 되돌릴 수 없습니다.`
    );

    if (!confirmed) return;

    setIsDeleting(true);

    try {
      const supabase = createClient();

      // 1️⃣ reviews 먼저 삭제 (FK 제약 회피)
      const { error: reviewError } = await supabase
        .from('reviews')
        .delete()
        .eq('project_id', projectId);

      if (reviewError) throw new Error(`검토 결과 삭제 실패: ${reviewError.message}`);

      // 2️⃣ documents 삭제
      const { error: docError } = await supabase
        .from('documents')
        .delete()
        .eq('project_id', projectId);

      if (docError) throw new Error(`문서 삭제 실패: ${docError.message}`);

      // 3️⃣ project 삭제
      const { error: projectError } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId);

      if (projectError) throw new Error(`프로젝트 삭제 실패: ${projectError.message}`);

      // 성공 시 대시보드 새로고침
      router.refresh();
    } catch (error) {
      console.error('[DeleteProject] 오류:', error);
      alert(`❌ 삭제 실패\n\n${error.message}\n\n다시 시도해주세요.`);
      setIsDeleting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isDeleting}
      className="flex-shrink-0 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed"
      title="프로젝트 삭제"
      aria-label={`${projectName} 프로젝트 삭제`}
    >
      {isDeleting ? (
        <span className="text-xs text-red-600 px-1">삭제중…</span>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" x2="10" y1="11" y2="17" />
          <line x1="14" x2="14" y1="11" y2="17" />
        </svg>
      )}
    </button>
  );
}
