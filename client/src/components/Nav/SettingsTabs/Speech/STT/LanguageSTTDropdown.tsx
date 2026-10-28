import { Dropdown } from '@librechat/client';
import { useRecoilState, useRecoilValue } from 'recoil';
import { useLocalize } from '~/hooks';
import store from '~/store';

export default function LanguageSTTDropdown() {
  const localize = useLocalize();
  const [languageSTT, setLanguageSTT] = useRecoilState<string>(store.languageSTT);
  const speechToText = useRecoilValue(store.speechToText);

  const languageOptions = [
    { value: 'id', label: 'Indonesia' },
    { value: 'en-US', label: 'English' },
  ];

  const handleSelect = (value: string) => {
    setLanguageSTT(value);
  };

  const labelId = 'language-stt-dropdown-label';

  return (
    <div className="flex items-center justify-between">
      <div id={labelId}>{localize('com_nav_language')}</div>
      <Dropdown
        value={languageSTT}
        onChange={handleSelect}
        options={languageOptions}
        testId="LanguageSTTDropdown"
        sizeClasses="z-50"
        className="z-50"
        aria-labelledby={labelId}
        disabled={!speechToText}
      />
    </div>
  );
}
