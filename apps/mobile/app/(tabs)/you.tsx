import { router } from 'expo-router';

import { youSectionPath, type YouSection } from '../../src/frame/links';
import { YouScreen } from '../../src/product/you';

export default function You() {
  return (
    <YouScreen
      onOpen={(section: YouSection) => {
        router.push(youSectionPath(section));
      }}
    />
  );
}
