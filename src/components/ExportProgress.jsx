import React from 'react';

const ExportProgress = ({ progress, status }) => {
  return (
    <div className="export-progress">
      <div style={{ marginBottom: '8px', fontWeight: '500' }}>
        Exporting Video
      </div>
      <div style={{ fontSize: '12px', color: '#ccc', marginBottom: '8px' }}>
        {status}
      </div>
      <div className="progress-bar">
        <div 
          className="progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div style={{ fontSize: '12px', textAlign: 'center', marginTop: '8px' }}>
        {Math.round(progress)}%
      </div>
    </div>
  );
};

export default ExportProgress; 