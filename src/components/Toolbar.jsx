import React, { useState, useRef, useEffect } from 'react';

const Toolbar = ({ 
  isPlaying, 
  onPlayPause, 
  onAddMedia, 
  onExport, 
  onClear,
  exportProgress,
  settings,
  onSettingsChange,
  // New props for project management and undo/redo
  onSaveProject,
  onLoadProject,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  currentProjectName
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef();

  // Close settings dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setShowSettings(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCanvasSizeChange = (width, height) => {
    onSettingsChange({
      ...settings,
      canvasWidth: width,
      canvasHeight: height
    });
  };

  const handleFrameRateChange = (fps) => {
    onSettingsChange({
      ...settings,
      exportFrameRate: Math.min(30, Math.max(1, fps))
    });
  };

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button onClick={onAddMedia} className="add-media-button">
          Add Media
        </button>
        
        <div className="toolbar-divider"></div>
        
        {/* Project Management */}
        <button onClick={onSaveProject} className="project-button save">
          💾 Save
        </button>
        <button onClick={onLoadProject} className="project-button load">
          📁 Load
        </button>
        
        <div className="toolbar-divider"></div>
        
        {/* Undo/Redo */}
        <button 
          onClick={onUndo} 
          className="action-button undo"
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button 
          onClick={onRedo} 
          className="action-button redo"
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          ↷
        </button>
        
        {currentProjectName && (
          <div className="project-name">
            📄 {currentProjectName}
          </div>
        )}
      </div>
      
      <div className="toolbar-center">
        <h1>Video Composer</h1>
      </div>
      
      <div className="toolbar-right">
        <div className="settings-container" ref={settingsRef}>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="settings-button"
          >
            Settings
          </button>
          
          {showSettings && (
            <div className="settings-dropdown">
              <div className="settings-section">
                <h3>Canvas Size</h3>
                <div className="settings-row">
                  <button
                    className={`preset-button ${settings.canvasWidth === 1920 && settings.canvasHeight === 1080 ? 'active' : ''}`}
                    onClick={() => handleCanvasSizeChange(1920, 1080)}
                  >
                    1920x1080 (HD)
                  </button>
                  <button
                    className={`preset-button ${settings.canvasWidth === 800 && settings.canvasHeight === 800 ? 'active' : ''}`}
                    onClick={() => handleCanvasSizeChange(800, 800)}
                  >
                    800x800 (Square)
                  </button>
                </div>
                <div className="settings-row">
                  <span>Current: {settings.canvasWidth}x{settings.canvasHeight}</span>
                </div>
              </div>
              
              <div className="settings-section">
                <h3>Export Frame Rate</h3>
                <div className="settings-row">
                  <label>FPS (1-30):</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={settings.exportFrameRate}
                    onChange={(e) => handleFrameRateChange(parseInt(e.target.value))}
                    className="fps-input"
                  />
                </div>
                <div className="settings-row">
                  <div className="fps-presets">
                    <button
                      className={`preset-button small ${settings.exportFrameRate === 15 ? 'active' : ''}`}
                      onClick={() => handleFrameRateChange(15)}
                    >
                      15 FPS
                    </button>
                    <button
                      className={`preset-button small ${settings.exportFrameRate === 24 ? 'active' : ''}`}
                      onClick={() => handleFrameRateChange(24)}
                    >
                      24 FPS
                    </button>
                    <button
                      className={`preset-button small ${settings.exportFrameRate === 30 ? 'active' : ''}`}
                      onClick={() => handleFrameRateChange(30)}
                    >
                      30 FPS
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      
        <button 
          onClick={onExport} 
          className="export-button"
          disabled={exportProgress !== null}
          style={{ opacity: exportProgress !== null ? 0.5 : 1 }}
        >
          Export WebM
        </button>
      
        <button onClick={onClear} className="clear-button">
          Clear All
        </button>
      </div>
    </div>
  );
};

export default Toolbar; 