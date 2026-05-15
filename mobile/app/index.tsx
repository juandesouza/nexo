import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { NexoLogo, colors, spacing } from "design-system/mobile";
import { API_ROOT, fetchApiHealth } from "../src/api";
import { mobileEnv, mobileWsOrigin } from "../src/env";

type HealthState =
  | { phase: "idle" | "loading" }
  | { phase: "ok"; service: string }
  | { phase: "error"; message: string };

export default function HomeScreen() {
  const [health, setHealth] = useState<HealthState>({ phase: "idle" });
  const [refreshing, setRefreshing] = useState(false);

  const runCheck = useCallback(async () => {
    setHealth((h) => (h.phase === "idle" ? { phase: "loading" } : h));
    const r = await fetchApiHealth();
    if (r.ok) {
      setHealth({ phase: "ok", service: r.data.service });
    } else {
      setHealth({ phase: "error", message: r.message });
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await runCheck();
    setRefreshing(false);
  }, [runCheck]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <NexoLogo width={160} height={44} />
        <Text style={styles.tagline}>Driver & delivery workspace</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>API</Text>
          <Text style={styles.mono}>{API_ROOT}</Text>
          {health.phase === "loading" || health.phase === "idle" ? (
            <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.primary} />
          ) : health.phase === "ok" ? (
            <Text style={styles.success}>Connected · {health.service}</Text>
          ) : health.phase === "error" ? (
            <Text style={styles.error}>{health.message}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Realtime (Socket.IO)</Text>
          <Text style={styles.mono}>{mobileWsOrigin}</Text>
          <Text style={styles.muted}>Passenger / driver flows will use this origin (same as web).</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Build</Text>
          <Text style={styles.muted}>Backend version: {mobileEnv.EXPO_PUBLIC_BACKEND_VERSION}</Text>
          <Text style={styles.muted}>
            Set EXPO_PUBLIC_API_BASE_URL in mobile/.env for LAN or ngrok (see .env.example).
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background
  },
  scroll: {
    padding: spacing.lg,
    paddingTop: 56,
    gap: spacing.lg
  },
  tagline: {
    color: colors.text,
    opacity: 0.85,
    fontSize: 16,
    marginTop: spacing.sm
  },
  card: {
    borderWidth: 1,
    borderColor: `${colors.primary}44`,
    borderRadius: 16,
    padding: spacing.lg,
    backgroundColor: "#0f1524"
  },
  cardTitle: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  mono: {
    color: colors.text,
    fontSize: 13,
    fontFamily: "monospace"
  },
  muted: {
    color: colors.text,
    opacity: 0.65,
    fontSize: 13,
    marginTop: spacing.sm,
    lineHeight: 20
  },
  success: {
    color: colors.secondary,
    fontSize: 15,
    fontWeight: "600",
    marginTop: spacing.md
  },
  error: {
    color: "#f87171",
    fontSize: 14,
    marginTop: spacing.md,
    lineHeight: 20
  }
});
