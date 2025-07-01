import React from 'react';

const ExportProgress = ({ progress, status }) => {
  // Ensure progress is a valid number, default to 0 if NaN or undefined
  const validProgress = isNaN(progress) || progress === undefined || progress === null ? 0 : progress;
  
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
          style={{ width: `${validProgress}%` }}
        />
      </div>
      <div style={{ fontSize: '12px', textAlign: 'center', marginTop: '8px' }}>
        {Math.round(validProgress)}%
      </div>
    </div>
  );
};

export default ExportProgress; 