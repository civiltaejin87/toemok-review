import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from './logout-button'

export default async function DashboardPage() {
  const supabase = await createClient()

  // 1. 현재 로그인된 사용자 가져오기
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // (미들웨어가 있어도 안전을 위해 한 번 더 체크)
  if (!user) {
    redirect('/login')
  }

  // 2. profiles 테이블에서 사용자 정보 가져오기
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // 3. 통계 가져오기 (현재는 0이지만 나중에 진짜 데이터)
  const { count: projectCount } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 상단 네비게이션 바 */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">토목-리뷰</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">
                {profile?.full_name || user.email}
              </span>
              <LogoutButton />
            </div>
          </div>
        </div>
      </nav>

      {/* 메인 콘텐츠 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 환영 메시지 */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900">
            안녕하세요, {profile?.full_name || '회원'}님 👋
          </h2>
          <p className="mt-2 text-gray-600">
            {profile?.company_name && (
              <>
                {profile.company_name} ·{' '}
              </>
            )}
            {profile?.role || '개인'} · {profile?.position || '사원'}
          </p>
        </div>

        {/* 통계 카드 영역 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard
            title="검토 프로젝트"
            value={projectCount || 0}
            unit="개"
            icon="📊"
            color="blue"
          />
          <StatCard
            title="업로드 문서"
            value={0}
            unit="개"
            icon="📄"
            color="green"
          />
          <StatCard
            title="발견된 이슈"
            value={0}
            unit="개"
            icon="⚠️"
            color="red"
          />
        </div>

        {/* 최근 프로젝트 영역 */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">📁 최근 프로젝트</h3>
            <button
              disabled
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + 새 프로젝트 만들기
            </button>
          </div>

          <div className="text-center py-12 text-gray-500">
            <p className="text-lg">아직 프로젝트가 없습니다</p>
            <p className="text-sm mt-2">
              검토할 내역서를 업로드하면 자동으로 프로젝트가 생성됩니다
            </p>
          </div>
        </div>

        {/* 곧 출시 안내 */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">
            🚧 베타 버전 진행 중
          </h3>
          <p className="text-sm text-blue-700">
            현재 회원가입 및 로그인 기능이 완성되었습니다. 다음 업데이트에서
            내역서 업로드 및 AI 검토 기능이 추가될 예정입니다.
          </p>
        </div>
      </main>
    </div>
  )
}

// 통계 카드 컴포넌트 (재사용)
function StatCard({ title, value, unit, icon, color }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-600">{title}</span>
        <span className="text-2xl">{icon}</span>
      </div>
      <div className="flex items-baseline">
        <span className={`text-3xl font-bold ${colorMap[color]}`}>{value}</span>
        <span className="ml-1 text-sm text-gray-500">{unit}</span>
      </div>
    </div>
  )
}