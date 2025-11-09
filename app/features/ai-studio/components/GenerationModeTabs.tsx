import { InlineStack } from '@shopify/polaris';

interface GenerationModeTabsProps {
  currentMode: 'ai-generation' | 'manual-upload';
  onModeChange: (mode: 'ai-generation' | 'manual-upload') => void;
}

export function GenerationModeTabs({
  currentMode,
  onModeChange,
}: GenerationModeTabsProps) {
  return (
    <div
      style={{
        borderBottom: '1px solid #E1E3E5',
        backgroundColor: '#FFFFFF',
        padding: '0 20px',
        marginBottom: '12px',
      }}
    >
      <InlineStack gap="400" align="start">
        <button
          onClick={() => onModeChange('ai-generation')}
          style={{
            background: 'none',
            border: 'none',
            padding: '12px 16px',
            cursor: 'pointer',
            borderBottom:
              currentMode === 'ai-generation' ? '2px solid #008060' : '2px solid transparent',
            color: currentMode === 'ai-generation' ? '#008060' : '#6D7175',
            fontWeight: currentMode === 'ai-generation' ? '600' : '400',
            fontSize: '14px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (currentMode !== 'ai-generation') {
              e.currentTarget.style.color = '#202223';
            }
          }}
          onMouseLeave={(e) => {
            if (currentMode !== 'ai-generation') {
              e.currentTarget.style.color = '#6D7175';
            }
          }}
        >
          🎭 AI Generation
        </button>
        <button
          onClick={() => onModeChange('manual-upload')}
          style={{
            background: 'none',
            border: 'none',
            padding: '12px 16px',
            cursor: 'pointer',
            borderBottom:
              currentMode === 'manual-upload' ? '2px solid #008060' : '2px solid transparent',
            color: currentMode === 'manual-upload' ? '#008060' : '#6D7175',
            fontWeight: currentMode === 'manual-upload' ? '600' : '400',
            fontSize: '14px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (currentMode !== 'manual-upload') {
              e.currentTarget.style.color = '#202223';
            }
          }}
          onMouseLeave={(e) => {
            if (currentMode !== 'manual-upload') {
              e.currentTarget.style.color = '#6D7175';
            }
          }}
        >
          📤 Manual Upload
        </button>
      </InlineStack>
    </div>
  );
}

