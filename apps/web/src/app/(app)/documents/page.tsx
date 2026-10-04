'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { Alert, Button } from '@erp/ui';

interface DocumentRow {
  id: string;
  title: string;
  filename: string;
  documentType: string | null;
  sizeBytes: string;
  version: number;
  createdAt: string;
}

function formatBytes(bytes: string): string {
  const n = Number(bytes);
  if (Number.isNaN(n)) return bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['documents', page],
    queryFn: () =>
      api.get<{ rows: DocumentRow[]; total: number }>(`/documents?page=${page}&pageSize=25`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name);
      // apiFetch without JSON content-type: browser sets the multipart boundary.
      const tokens = JSON.parse(window.localStorage.getItem('erp.tokens') ?? 'null') as {
        accessToken: string;
      } | null;
      const res = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: tokens?.accessToken
          ? { Authorization: `Bearer ${tokens.accessToken}` }
          : undefined,
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Upload failed');
      }
      return (await res.json()) as { data: unknown };
    },
    onSuccess: () => {
      setUploadError(null);
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (e) => {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    },
  });

  const columns: Array<DataTableColumn<DocumentRow>> = [
    { key: 'title', header: 'Title', render: (d) => d.title },
    { key: 'filename', header: 'File', render: (d) => d.filename },
    { key: 'type', header: 'Type', render: (d) => d.documentType ?? '—' },
    { key: 'size', header: 'Size', render: (d) => formatBytes(d.sizeBytes) },
    { key: 'version', header: 'Version', render: (d) => `v${d.version}` },
    {
      key: 'createdAt',
      header: 'Uploaded',
      render: (d) => new Date(d.createdAt).toLocaleString(),
    },
    {
      key: 'actions',
      header: '',
      render: (d) => (
        <a
          href={`/api/v1/documents/${d.id}/download`}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--erp-primary)] hover:underline"
          onClick={(e) => {
            // Authorization-checked download endpoint requires the bearer token,
            // which plain links cannot send; fetch once to audit the access,
            // then hand the browser the authenticated redirect.
            e.preventDefault();
            const downloadPath = `/documents/${d.id}/download`;
            apiFetch(downloadPath, {})
              .then(() => {
                window.open(`/api/v1${downloadPath}`, '_blank');
              })
              .catch(() => {
                setUploadError('Download failed — you may lack permission.');
              });
          }}
        >
          Download
        </a>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Versioned, access-controlled document storage."
        actions={
          <div>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button loading={upload.isPending} onClick={() => fileInput.current?.click()}>
              Upload document
            </Button>
          </div>
        }
      />

      {uploadError ? (
        <div className="mb-4">
          <Alert tone="error" title="Upload failed">
            {uploadError}
          </Alert>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={listQuery.data?.rows}
        loading={listQuery.isLoading}
        error={listQuery.error}
        total={listQuery.data?.total}
        page={page}
        pageSize={25}
        onPageChange={setPage}
        getRowKey={(d) => d.id}
        caption="Documents"
      />
    </div>
  );
}
