'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const FILE_CATEGORIES = [
  { key: 'pumseum', label: '품셈', emoji: '1️⃣', desc: '작업별 표준 단가표' },
  { key: 'ilwidaega', label: '일위대가', emoji: '2️⃣', desc: '작업 단위별 대가표' },
  { key: 'noim', label: '노임단가', emoji: '3️⃣', desc: '인건비 단가표' },
  { key: 'jajae', label: '자재단가', emoji: '4️⃣', desc: '자재비 단가표' },
  { key: 'pyojun', label: '표준시장단가', emoji: '5️⃣', desc: '시장 표준 가격' },
];

const ALLOWED_EXTENSIONS = ['.pdf', '.xls', '.xlsx'];
const MAX_FILE_SIZE = 50 * 1024 * 1024;

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function NewProjectPage() {
  const router = useRouter();
  const supabase = createClient();

  const [projectName, setProjectName] = useState('');
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState({ step: '', current: 0, total: 0 });

  const validateFile = (file) => {
    const fileName = file.name.toLowerCase();
    const validExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
    if (!validExtension) return 'PDF 또는 Excel 파일만 업로드 가능합니다.';
    if (file.size > MAX_FILE_SIZE) return `파일 크기는 50MB 이하여야 합니다. (현재: ${formatFileSize(file.size)})`;
    return null;
  };

  const handleFileChange = (categoryKey, file) => {
    if (!file) return;
    const validationError = validateFile(file);
    if (validationError) {
      setError(`[${FILE_CATEGORIES.find(c => c.key === categoryKey).label}] ${validationError}`);
      return;
    }
    setError(null);
    setFiles(prev => ({ ...prev, [categoryKey]: file }));
  };

  const handleFileRemove = (categoryKey) => {
    setFiles(prev => {
      const newFiles = { ...prev };
      delete newFiles[categoryKey];
      return newFiles;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!projectName.trim()) {
      setError('공사명을 입력해주세요.');
      return;
    }

    const uploadedFiles = FILE_CATEGORIES
      .filter(cat => files[cat.key])
      .map(cat => ({ category: cat.key, label: cat.label, file: files[cat.key] }));

    if (uploadedFiles.length === 0) {
      setError('최소 1개 카테고리의 파일을 업로드해주세요.');
      return;
    }

    setLoading(true);

    try {
      setUploadProgress({ step: '사용자 인증 중...', current: 0, total: 0 });
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('로그인이 필요합니다.');

      setUploadProgress({ step: '프로젝트 생성 중...', current: 0, total: 0 });
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({ user_id: user.id, name: projectName.trim(), status: 'pending' })
        .select()
        .single();

      if (projectError) throw new Error(`프로젝트 생성 실패: ${projectError.message}`);

      const projectId = project.id;
      const totalFiles = uploadedFiles.length;

      for (let i = 0; i < totalFiles; i++) {
        const { category, label, file } = uploadedFiles[i];
        setUploadProgress({ step: `파일 업로드 중: ${label}`, current: i + 1, total: totalFiles });

        const fileExtension = file.name.split('.').pop().toLowerCase();
        const storagePath = `${user.id}/${projectId}/${category}.${fileExtension}`;

        const { error: uploadError } = await supabase.storage
          .from('project-files')
          .upload(storagePath, file, { cacheControl: '3600', upsert: false });

        if (uploadError) throw new Error(`${label} 업로드 실패: ${uploadError.message}`);

        const { error: docError } = await supabase
          .from('documents')
          .insert({
            project_id: projectId,
            user_id: user.id,
            category: category,
            filename: file.name,
            file_size: file.size,
            file_type: file.type || 'application/octet-stream',
            storage_path: storagePath,
          });

        if (docError) throw new Error(`${label} DB 저장 실패: ${docError.message}`);
      }

      setUploadProgress({ step: '완료!', current: totalFiles, total: totalFiles });

      setTimeout(() => {
        alert(`🎉 프로젝트 "${projectName}" 생성 완료!\n${totalFiles}개 파일 업로드 성공!`);
        router.push(`/dashboard/projects/${projectId}`);
      }, 500);

    } catch (err) {
      console.error('전체 에러:', err);
      setError(err.message || '업로드 중 오류가 발생했습니다.');
      setLoading(false);
      setUploadProgress({ step: '', current: 0, total: 0 });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard" className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4 text-sm">
          ← 대시보드로 돌아가기
        </Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">🏗️ 새 프로젝트 만들기</h1>
          <p className="text-sm text-gray-600">검토할 토목 내역서를 업로드하세요. 최소 1개 카테고리 필수.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <label htmlFor="projectName" className="block text-base font-semibold text-gray-900 mb-2">
              공사명 <span className="text-red-500">*</span>
            </label>
            <input
              id="projectName"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="예: ○○지구 도로 확장 공사"
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              required
            />
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">
                📎 파일 업로드 <span className="text-sm font-normal text-gray-500">(PDF / Excel · 최대 50MB)</span>
              </h2>
              <span className="text-sm font-semibold text-blue-600">{Object.keys(files).length}/5</span>
            </div>

            <div className="space-y-2">
              {FILE_CATEGORIES.map((category) => (
                <FileUploadBox
                  key={category.key}
                  category={category}
                  file={files[category.key]}
                  onFileChange={(file) => handleFileChange(category.key, file)}
                  onFileRemove={() => handleFileRemove(category.key)}
                  disabled={loading}
                />
              ))}
            </div>
          </div>

          {loading && uploadProgress.step && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm font-medium text-blue-900">{uploadProgress.step}</p>
              </div>
              {uploadProgress.total > 0 && (
                <div className="ml-8">
                  <div className="flex justify-between text-xs text-blue-700 mb-1">
                    <span>진행률</span>
                    <span>{uploadProgress.current} / {uploadProgress.total}</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">⚠️ {error}</p>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Link href="/dashboard" className={`px-5 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm ${loading ? 'pointer-events-none opacity-50' : ''}`}>
              취소
            </Link>
            <button type="submit" disabled={loading} className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
              {loading ? '업로드 중...' : '프로젝트 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FileUploadBox({ category, file, onFileChange, onFileRemove, disabled }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleClick = () => { if (!disabled) inputRef.current?.click(); };
  const handleInputChange = (e) => { const f = e.target.files?.[0]; if (f) onFileChange(f); e.target.value = ''; };
  const handleDragOver = (e) => { e.preventDefault(); if (!disabled) setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); if (disabled) return; const f = e.dataTransfer.files?.[0]; if (f) onFileChange(f); };

  if (file) {
    return (
      <div className={`flex items-center gap-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg ${disabled ? 'opacity-60' : ''}`}>
        <span className="text-base flex-shrink-0">{category.emoji}</span>
        <span className="text-sm font-medium text-gray-900 w-24 flex-shrink-0">{category.label}</span>
        <span className="text-sm flex-shrink-0">📄</span>
        <span className="text-sm text-gray-700 truncate flex-1 min-w-0">{file.name}</span>
        <span className="text-xs text-gray-500 flex-shrink-0">{formatFileSize(file.size)}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={handleClick} disabled={disabled} className="px-2 py-1 text-xs border border-gray-300 bg-white rounded hover:bg-gray-50 transition disabled:opacity-50">변경</button>
          <button type="button" onClick={onFileRemove} disabled={disabled} className="px-2 py-1 text-xs border border-red-300 text-red-700 bg-white rounded hover:bg-red-50 transition disabled:opacity-50">제거</button>
        </div>
        <input ref={inputRef} type="file" accept=".pdf,.xls,.xlsx" onChange={handleInputChange} className="hidden" />
      </div>
    );
  }

  return (
    <div onClick={handleClick} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      className={`flex items-center gap-3 px-3 py-2 border-2 border-dashed rounded-lg transition ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}>
      <span className="text-base flex-shrink-0">{category.emoji}</span>
      <span className="text-sm font-medium text-gray-900 w-24 flex-shrink-0">{category.label}</span>
      <span className="text-xs text-gray-500 flex-1 min-w-0 truncate">{category.desc}</span>
      <span className="text-xs text-gray-500 flex-shrink-0">📁 클릭 또는 드래그</span>
      <input ref={inputRef} type="file" accept=".pdf,.xls,.xlsx" onChange={handleInputChange} className="hidden" />
    </div>
  );
}