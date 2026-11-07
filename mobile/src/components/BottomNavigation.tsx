import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';

export type TabType = 'home' | 'files' | 'shared' | 'activity' | 'settings';

interface Props {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export default function BottomNavigation({ currentTab, onTabChange }: Props) {
  const tabs: { key: TabType; label: string; icon: string }[] = [
    { key: 'home', label: 'Home', icon: '⚡' },
    { key: 'files', label: 'Files', icon: '📁' },
    { key: 'shared', label: 'Shared', icon: '🔗' },
    { key: 'activity', label: 'Activity', icon: '🛡️' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <View style={styles.container}>
      {tabs.map((t) => {
        const isActive = currentTab === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tabItem}
            onPress={() => onTabChange(t.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>
              {t.icon}
            </Text>
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 64,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 4,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  tabIcon: {
    fontSize: 18,
    marginBottom: 2,
    opacity: 0.6,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
  },
  tabLabelActive: {
    color: '#60a5fa',
  },
});
