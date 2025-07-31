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
  const [showClearModal, setShowClearModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
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

  const handleClearAll = () => {
    setShowClearModal(true);
  };

  const handleConfirmClear = () => {
    onClear();
    setShowClearModal(false);
  };

  const handleCancelClear = () => {
    setShowClearModal(false);
  };

  const handleAbout = () => {
    setShowAboutModal(true);
  };

  const handleCloseAbout = () => {
    setShowAboutModal(false);
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17,21 17,13 7,13 7,21"/>
            <polyline points="7,3 7,8 15,8"/>
          </svg>
          Save
        </button>
        <button onClick={onLoadProject} className="project-button load">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <line x1="10" y1="9" x2="8" y2="9"/>
          </svg>
          Load
        </button>
        
        <div className="toolbar-divider"></div>
        
        {/* Undo/Redo */}
        <button 
          onClick={onUndo} 
          className="action-button undo"
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7v6h6"/>
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
          </svg>
        </button>
        <button 
          onClick={onRedo} 
          className="action-button redo"
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 7v6h-6"/>
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
          </svg>
        </button>
        
        {currentProjectName && (
          <div className="project-name">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
            </svg>
            {currentProjectName}
          </div>
        )}
      </div>
      
      <div className="toolbar-center">
        <h1>EZ Web Video Editor</h1>
        <button 
          onClick={handleAbout} 
          className="about-button"
          title="About this tool"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9,9h0a3,3,0,0,1,6,0c0,2-3,3-3,3"/>
            <path d="M12,17h0"/>
          </svg>
        </button>
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
                {/* <h3>Export Frame Rate</h3> */}
                {/* <div className="settings-row">
                  <label>FPS (1-30):</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={settings.exportFrameRate}
                    onChange={(e) => handleFrameRateChange(parseInt(e.target.value))}
                    className="fps-input"
                  />
                </div> */}
                {/* <div className="settings-row">
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
                </div> */}
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
      
        <button onClick={handleClearAll} className="clear-button">
          Clear All
        </button>
      </div>

      {/* Confirmation Modal */}
      {showClearModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Clear All Content</h3>
            <p>Are you sure you want to clear all media and timeline content? This action cannot be undone.</p>
            <div className="modal-buttons">
              <button onClick={handleCancelClear} className="modal-button cancel">
                Cancel
              </button>
              <button onClick={handleConfirmClear} className="modal-button confirm">
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About Modal */}
      {showAboutModal && (
        <div className="modal-overlay">
          <div className="modal-content about-modal">
            <h3>About EZ Web Video Editor</h3>
            <div className="about-content">
              <p>
                EZ Web Video Editor is a modern web-based video editing tool specifically designed to create and export videos in <strong>transparent WebM format</strong>.
              </p>
              <p>
                <strong>Key Features:</strong>
              </p>
              <ul>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style="display: inline; margin-right: 8px; vertical-align: text-top;">
                    <path d="M9 12l2 2 4-4"/>
                    <circle cx="12" cy="12" r="10"/>
                  </svg>
                  Everything runs and is stored locally on your device - no data leaves your browser
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style="display: inline; margin-right: 8px; vertical-align: text-top;">
                    <path d="M9 12l2 2 4-4"/>
                    <circle cx="12" cy="12" r="10"/>
                  </svg>
                  Export videos with transparency support (WebM format)
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style="display: inline; margin-right: 8px; vertical-align: text-top;">
                    <path d="M9 12l2 2 4-4"/>
                    <circle cx="12" cy="12" r="10"/>
                  </svg>
                  Perfect for creating short memes and video assets
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style="display: inline; margin-right: 8px; vertical-align: text-top;">
                    <path d="M9 12l2 2 4-4"/>
                    <circle cx="12" cy="12" r="10"/>
                  </svg>
                  Modern drag-and-drop interface for intuitive editing
                </li>
              </ul>
              <p>
                This tool was designed to create short memes and assets for <a href="https://tangia.co" target="_blank" rel="noopener noreferrer"><strong>Tangia.co</strong></a> - the ultimate platform for streamer interactions and engagement.
              </p>
              <p>
                <strong>Need help or found an issue?</strong> Send an email to <a href="mailto:alex@tangia.co"><strong>alex@tangia.co</strong></a>
              </p>
            </div>
            <div className="modal-buttons">
              <button onClick={handleCloseAbout} className="modal-button confirm">
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Toolbar; 