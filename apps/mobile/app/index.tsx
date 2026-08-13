import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

export default function ConsumerMobileShell() {
  return (
    <View accessibilityRole="summary">
      <Text>VELORA</Text>
      <Text accessibilityRole="header">Consumer Mobile</Text>
      <Text>Foundation shell. Product UI is not implemented.</Text>
      <StatusBar style="auto" />
    </View>
  );
}
