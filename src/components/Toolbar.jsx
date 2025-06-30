import React from 'react';

const Toolbar = ({ 
  onAddMedia, 
  onPlayPause, 
  onExport, 
  onClear,
  isPlaying,
  exportProgress 
}) => {
  return (
    <div className="toolbar">
      <h1 style={{ fontSize: '18px', fontWeight: '600', marginRight: '20px' }}>
        Video Composer
      </h1>
      
      <button onClick={onAddMedia}>
        📁 Add Media
      </button>
      
      <div style={{ width: '1px', height: '30px', background: '#555', margin: '0 15px' }} />
      
      <button onClick={onPlayPause}>
        {isPlaying ? '⏸️ Pause' : '▶️ Play'}
      </button>
      
      <div style={{ width: '1px', height: '30px', background: '#555', margin: '0 15px' }} />
      
      <button 
        onClick={onExport} 
        disabled={exportProgress !== null}
        title="Export 1920x1080 WebM with alpha channel (15 FPS). Uses frame-by-frame encoding to avoid memory issues."
        style={{
          position: 'relative'
        }}
      >
        {exportProgress ? '⏳ Exporting...' : '📤 Export WebM'}
      </button>
      
      <button onClick={onClear}>
        🗑️ Clear All
      </button>
      
      <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#ccc', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div>Add media to source library • Drag to timeline • Space to play/pause</div>
        <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
          Export: 1920x1080 @ 15fps with alpha channel • Frame-by-frame encoding
        </div>
      </div>
    </div>
  );
};

export default Toolbar; 