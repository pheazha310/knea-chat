import React from 'react';
import { resolveFileUrl } from '../../models';

interface FilePreviewProps {
  url: string;
  name: string;
  type?: string | null;
}

const FilePreview = ({ url, name, type }: FilePreviewProps) => {
  const resolvedUrl = resolveFileUrl(url);

  const renderPreview = () => {
    if (!type) {
      return (
        <div className="text-center py-12">
          <div className="text-4xl mb-4">📄</div>
          <p className="text-muted">Preview not available for this file type</p>
          <a href={resolvedUrl} download={name} className="btn-primary mt-4 inline-block">
            Download File
          </a>
        </div>
      );
    }

    if (type.startsWith('image/')) {
      return (
        <div className="text-center">
          <img src={resolvedUrl} alt={name} className="max-w-full max-h-96 mx-auto rounded-lg shadow" />
        </div>
      );
    }

    if (type.startsWith('video/')) {
      return (
        <div className="text-center">
          <video controls className="max-w-full max-h-96 mx-auto rounded-lg shadow" preload="metadata">
            <source src={resolvedUrl} type={type} />
            Your browser does not support the video tag.
          </video>
        </div>
      );
    }

    if (type.startsWith('audio/')) {
      return (
        <div className="text-center py-8">
          <div className="text-6xl mb-4">🎵</div>
          <audio controls className="w-full max-w-md mx-auto" preload="metadata">
            <source src={resolvedUrl} type={type} />
            Your browser does not support the audio tag.
          </audio>
        </div>
      );
    }

    if (type === 'application/pdf') {
      return (
        <div className="text-center">
          <iframe
            src={resolvedUrl}
            title={name}
            className="w-full h-96 rounded-lg border border-gray-200 dark:border-gray-700"
          />
        </div>
      );
    }

    if (type.startsWith('text/') || type.includes('csv')) {
      return (
        <div className="text-center">
          <iframe
            src={resolvedUrl}
            title={name}
            className="w-full h-96 rounded-lg border border-gray-200 dark:border-gray-700 bg-white"
          />
        </div>
      );
    }

    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">📄</div>
        <p className="text-muted">Preview not available for this file type</p>
        <a href={resolvedUrl} download={name} className="btn-primary mt-4 inline-block">
          Download File
        </a>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {renderPreview()}
      <div className="text-center">
        <a href={resolvedUrl} download={name} className="btn-secondary">
          Download {name}
        </a>
      </div>
    </div>
  );
};

export default FilePreview;
