import React, { useState, useEffect } from 'react';

const TenorSearch = ({ onStickerSelect }) => {
  // Access environment variable - Vite uses import.meta.env
  const TENOR_API_KEY = import.meta.env.VITE_TENOR_API_KEY;
  
  const [searchTerm, setSearchTerm] = useState('');
  const [stickers, setStickers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [nextPos, setNextPos] = useState(null);

  console.log('Tenor API Key available:', !!TENOR_API_KEY);

  // Search for stickers using Tenor API with proper transparency filtering
  const searchStickers = async (query = '', loadMore = false) => {
    if (!TENOR_API_KEY) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // All transparent sticker formats as specified in the guidelines
      const TRANSPARENT_FORMATS = [
        'gif_transparent',
        'tinygif_transparent', 
        'nanogif_transparent',
        'webp_transparent',
        'tinywebp_transparent',
        'nanowebp_transparent'
      ];

      const params = new URLSearchParams({
        key: TENOR_API_KEY,
        q: query,
        searchfilter: 'sticker', // Only get stickers with transparency
        media_filter: TRANSPARENT_FORMATS.join(','), // Only transparent formats
        limit: '20',
        client_key: 'partyMaker_app',
        country: 'US',
        locale: 'en_US'
      });

      if (loadMore && nextPos) {
        params.set('pos', nextPos);
      }

      const endpoint = query.trim() ? 'search' : 'featured';
      const apiUrl = `https://tenor.googleapis.com/v2/${endpoint}?${params}`;
      
      console.log('Making request to:', apiUrl);
      
      // Try using a simple and reliable CORS proxy
      const proxyUrl = 'https://corsproxy.io/?';
      const proxiedUrl = proxyUrl + encodeURIComponent(apiUrl);
      
      const response = await fetch(proxiedUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      });
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} - ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Raw Tenor API response:', data);
      
      // Log a sample result to see what fields are available
      if (data.results && data.results.length > 0) {
        console.log('Sample result fields:', Object.keys(data.results[0]));
        console.log('Sample result:', data.results[0]);
      }
      
      // Filter results to only those that have at least one transparent format
      const filteredResults = data.results?.filter(result => {
        return TRANSPARENT_FORMATS.some(fmt => result.media_formats && result.media_formats[fmt]);
      }) || [];

      const processedStickers = filteredResults.map(result => {
        console.log('Processing result:', result);
        console.log('Available media formats:', result.media_formats);
        
        // Prioritize transparent formats in order of preference
        let stickerUrl = null;
        let previewUrl = null;
        let width = 200;
        let height = 200;
        let selectedFormat = null;
        
        // Debug: Log all available formats for this result
        const availableFormats = Object.keys(result.media_formats || {});
        console.log('Available formats for result', result.id, ':', availableFormats);
        
        // Try different transparent formats in order of preference (animated GIF first)
        const formatPriority = [
          'gif_transparent',     // Full size animated GIF with transparency - PRIORITY
          'tinygif_transparent', // Small animated GIF with transparency  
          'nanogif_transparent', // Tiny animated GIF with transparency
          'webp_transparent',    // Full size WebP with transparency (may be static)
          'tinywebp_transparent', // Small WebP with transparency (may be static)
          'nanowebp_transparent'  // Tiny WebP with transparency (may be static)
        ];
        
        for (const format of formatPriority) {
          if (result.media_formats?.[format]) {
            const formatData = result.media_formats[format];
            stickerUrl = formatData.url;
            selectedFormat = format;
            const dims = formatData.dims;
            if (dims && dims.length >= 2) {
              width = dims[0];
              height = dims[1];
            }
            
            console.log(`Selected ${format} format for result ${result.id}:`, {
              url: stickerUrl,
              dims: dims,
              size: formatData.size || 'unknown',
              duration: formatData.duration || 'unknown'
            });
            break;
          }
        }
        
        // Get preview URL (prefer smaller formats for preview, but still animated)
        const previewPriority = ['nanogif_transparent', 'tinygif_transparent', 'gif_transparent'];
        for (const format of previewPriority) {
          if (result.media_formats?.[format]) {
            previewUrl = result.media_formats[format].url;
            console.log(`Using ${format} for preview:`, previewUrl);
            break;
          }
        }
        
        // Fallback to main URL if no preview
        if (!previewUrl) previewUrl = stickerUrl;
        
        // This should never happen due to our filtering above, but safety check
        if (!stickerUrl) {
          console.warn('No transparent format found for result:', result.id);
          return null;
        }

        console.log('Final selected URLs:', { main: stickerUrl, preview: previewUrl });

        // Extract name from URL - much more reliable than API fields
        let stickerName = 'Tenor Sticker'; // Default fallback
        
        try {
          // Parse the URL to get the descriptive name
          // URL format: https://media.tenor.com/{ID}/{descriptive-name}.gif
          const url = new URL(stickerUrl);
          const pathParts = url.pathname.split('/');
          
          if (pathParts.length >= 3) {
            // Get the last part (filename) and remove extension
            const filename = pathParts[pathParts.length - 1];
            const nameWithoutExt = filename.split('.')[0];
            
            // Convert from kebab-case to readable name
            if (nameWithoutExt && nameWithoutExt !== 'undefined' && nameWithoutExt.length > 1) {
              stickerName = nameWithoutExt
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
            }
          }
        } catch (error) {
          console.warn('Failed to extract name from URL:', stickerUrl, error);
          // Keep default fallback
        }

        console.log('Extracted sticker name:', stickerName, 'from URL:', stickerUrl);

        return {
          id: result.id,
          description: stickerName,
          url: stickerUrl,
          preview: previewUrl,
          width: width,
          height: height,
          tenorUrl: result.itemurl,
          tags: result.tags || [],
          hasTransparency: true,
          format: selectedFormat
        };
      }).filter(Boolean); // Remove any null results

      console.log('Processed transparent stickers:', processedStickers);

      if (loadMore) {
        setStickers(prev => [...prev, ...processedStickers]);
      } else {
        setStickers(processedStickers);
      }
      
      setNextPos(data.next || null);
    } catch (err) {
      console.error('Error fetching stickers:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Load trending stickers on mount
  useEffect(() => {
    searchStickers('');
  }, [TENOR_API_KEY]);

  // Handle search input change with debouncing
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchStickers(searchTerm);
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  // Handle sticker selection
  const handleStickerClick = (sticker) => {
    console.log('Selected Tenor Sticker:', sticker);
    
    // Convert to our media format
    const mediaItem = {
      id: `tenor_${sticker.id}`,
      name: sticker.description || 'Tenor Sticker',
      type: 'image',
      subtype: sticker.format && sticker.format.includes('gif') ? 'gif' : 'sticker', // More specific subtype
      url: sticker.url,
      width: sticker.width,
      height: sticker.height,
      duration: 3, // Default 3 seconds for stickers
      source: 'tenor',
      tenorUrl: sticker.tenorUrl,
      tags: sticker.tags,
      hasTransparency: sticker.hasTransparency,
      format: sticker.format // Keep original format info for debugging
    };

    // Add to source media (if callback provided)
    if (onStickerSelect) {
      onStickerSelect(mediaItem);
    }

    // Also trigger a custom event for drag-and-drop compatibility
    const event = new CustomEvent('tenor-gif-selected', { 
      detail: { mediaItem } 
    });
    window.dispatchEvent(event);
  };

  if (!TENOR_API_KEY) {
    return (
      <div style={{
        padding: '16px',
        textAlign: 'center',
        color: '#999',
        fontSize: '12px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}>
        <div>⚠️ Tenor API key not configured</div>
        <div style={{ marginTop: '8px', fontSize: '10px' }}>
          Check your .env file: VITE_TENOR_API_KEY
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#2a2a2a'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #444',
        fontWeight: 'bold',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        🎭 Stickers
      </div>

      {/* Search Input */}
      <div style={{ padding: '12px 16px' }}>
        <input
          type="text"
          placeholder="Search transparent stickers..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #444',
            borderRadius: '4px',
            backgroundColor: '#1a1a1a',
            color: '#fff',
            fontSize: '14px',
            outline: 'none'
          }}
        />
      </div>

      {/* Results */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '0 16px 16px'
      }}>
        {loading && stickers.length === 0 && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100px',
            color: '#999'
          }}>
            Loading transparent stickers...
          </div>
        )}

        {error && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100px',
            color: '#ff6b6b',
            fontSize: '12px',
            textAlign: 'center',
            padding: '16px'
          }}>
            <div>
              <div>⚠️ Error loading stickers</div>
              <div style={{ marginTop: '8px', fontSize: '10px' }}>{error}</div>
              <div style={{ marginTop: '8px', fontSize: '10px' }}>
                CORS proxy may be down. Try refreshing the page.
              </div>
            </div>
          </div>
        )}

        {!loading && !error && stickers.length === 0 && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100px',
            color: '#999',
            fontSize: '12px'
          }}>
            No transparent stickers found
          </div>
        )}

        {/* Sticker Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
          gap: '8px',
          paddingBottom: '16px'
        }}>
          {stickers.map((sticker) => (
            <button
              key={sticker.id}
              onClick={() => handleStickerClick(sticker)}
              style={{
                border: 'none',
                borderRadius: '4px',
                padding: '4px',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                aspectRatio: '1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              title={`${sticker.description} (${sticker.width}x${sticker.height})`}
            >
              <img
                src={sticker.preview}
                alt={sticker.description}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain'
                }}
                loading="lazy"
              />
            </button>
          ))}
        </div>

        {/* Load More Button */}
        {nextPos && !loading && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: '16px'
          }}>
            <button
              onClick={() => searchStickers(searchTerm, true)}
              style={{
                padding: '8px 16px',
                border: '1px solid #444',
                borderRadius: '4px',
                backgroundColor: '#1a1a1a',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Load More
            </button>
          </div>
        )}

        {loading && stickers.length > 0 && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '16px',
            color: '#999',
            fontSize: '12px'
          }}>
            Loading more...
          </div>
        )}
      </div>

      {/* Attribution (required by Tenor) */}
      <div style={{
        padding: '8px 16px',
        borderTop: '1px solid #444',
        fontSize: '10px',
        color: '#666',
        textAlign: 'center'
      }}>
        Powered by Tenor • Transparent Stickers Only
      </div>
    </div>
  );
};

export default TenorSearch; 