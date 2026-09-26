import { SafeAreaView } from 'react-native-safe-area-context';

import { HomeScreen } from '@/components/home/HomeScreen';

export default function Home() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <HomeScreen />
    </SafeAreaView>
  );
}
