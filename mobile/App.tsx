import React, { useState, useEffect } from 'react';
import { StyleSheet, View, SafeAreaView, StatusBar, ActivityIndicator } from 'react-native';
import { getSessionToken } from './src/crypto/keyStorage';
import { promptBiometricAuth } from './src/services/biometrics';
import { getLocalDatabase } from './src/database/sqlite';
import HomeScreen from './src/screens/HomeScreen';
import FilesScreen from './src/screens/FilesScreen';
import SharedScreen from './src/screens/SharedScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AuthScreen from './src/screens/AuthScreen';
import BottomNavigation, { TabType } from './src/components/BottomNavigation';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [currentTab, setCurrentTab] = useState<TabType>('home');

  async function checkAuth() {
    try {
      await getLocalDatabase();
      const token = await getSessionToken();
      if (token) {
        const bioOk = await promptBiometricAuth();
        setIsAuthenticated(bioOk);
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    }
  }

  useEffect(() => {
    checkAuth();
  }, []);

  if (isAuthenticated === null) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
        <AuthScreen onAuthenticated={() => setIsAuthenticated(true)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
      <View style={styles.content}>
        {currentTab === 'home' && (
          <HomeScreen onNavigateFiles={() => setCurrentTab('files')} />
        )}
        {currentTab === 'files' && <FilesScreen />}
        {currentTab === 'shared' && <SharedScreen />}
        {currentTab === 'activity' && <ActivityScreen />}
        {currentTab === 'settings' && (
          <SettingsScreen onSignOut={() => setIsAuthenticated(false)} />
        )}
      </View>
      <BottomNavigation currentTab={currentTab} onTabChange={setCurrentTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0b0f19',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
