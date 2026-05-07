import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import LogoutButton from './logout-button';

const STATUS_BADGES = {
  pending: { label: '대기', className: 'bg-gray-100 text-gray-700' },
  analyzing: { label: '분석 중', className: 'bg-blue-100 text-blue-700' },
  completed: { label: '완료', className: 'bg-green-100 text-green-700' },
  failed: { label: '실패', className: 'bg-red-100 text-red-700' },
};

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const displayName = profile?.full_name || user.email?.split('@')[0] || '사용자';

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const projectsList = projects || [];
  const totalProjects = projectsList.length;

  const { count: totalDocuments } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const totalIssues = 0;

  const projectsWithCount = await Promise.all(
    projectsList.map(async (project) => {
      const { count } = await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id);

      return { ...project, fileCount: count || 0 };
    })
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">토목-리뷰</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{displayName}</span>
            <LogoutButton />
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-8">

        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 mb-1">
            안녕하세요, {displayName}님 👋
          </h2>
          {profile && (
            <p className="text-sm text-gray-500">
              {[profile.company, profile.role, profile.position].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-gray-600">검토 프로젝트</h3>
              <span className="text-xl">📊</span>
            </div>
            <p className="text-3xl font-bold text-blue-600">{totalProjects}<span className="text-base font-normal text-gray-500 ml-1">개</span></p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-gray-600">업로드 문서</h3>
              <span className="text-xl">📄</span>
            </div>
            <p className="text-3xl font-bold text-green-600">{totalDocuments || 0}<span className="text-base font-normal text-gray-500 ml-1">개</span></p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-gray-600">발견된 이슈</h3>
              <span className="text-xl">⚠️</span>
            </div>
            <p className="text-3xl font-bold text-red-600">{totalIssues}<span className="text-base font-normal text-gray-500 ml-1">개</span></p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              📁 프로젝트 목록
              <span className="ml-2 text-sm font-normal text-gray-500">({totalProjects}개)</span>
            </h2>
            <Link
              href="/dashboard/new"
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
            >
              + 새 프로젝트
            </Link>
          </div>

          {projectsWithCount.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">📂</div>
              <p className="text-gray-700 font-medium mb-1">아직 프로젝트가 없습니다</p>
              <p className="text-sm text-gray-500 mb-4">
                토목 내역서를 업로드하고 AI 검토를 시작해보세요
              </p>
              <Link
                href="/dashboard/new"
                className="inline-block px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
              >
                첫 프로젝트 만들기
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {projectsWithCount.map((project) => {
                const status = STATUS_BADGES[project.status] || STATUS_BADGES.pending;

                return (
                  <Link
                    key={project.id}
                    href={`/dashboard/projects/${project.id}`}
                    className="block bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg p-4 transition"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base font-semibold text-gray-900 truncate">
                            🏗️ {project.name}
                          </h3>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${status.className} flex-shrink-0`}>
                            {status.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>📅 {formatDate(project.created_at)}</span>
                          <span>📎 파일 {project.fileCount}개</span>
                        </div>
                      </div>
                      <span className="text-gray-400 flex-shrink-0">→</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-1">🚧 베타 버전 진행 중</h3>
          <p className="text-sm text-blue-700">
            현재 파일 업로드 및 텍스트 추출 기능이 동작합니다. AI 검토 기능(Phase 4-3)이 곧 추가됩니다.
          </p>
        </div>

      </div>
    </div>
  );
}