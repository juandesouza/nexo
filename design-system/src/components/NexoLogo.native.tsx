import { Image } from "react-native";
import { NEXO_LOGO_TITLE, type NexoLogoProps } from "./NexoLogo.shared";

// Raster wordmark avoids react-native-svg native views (LinearGradient) mismatching Expo Go.
const WORDMARK = require("../../assets/logo/b3c48faf-00d9-4603-ac43-f49015e74cb2.png");

export function NexoLogo({ width = 148, height = 40 }: NexoLogoProps) {
  return (
    <Image
      accessibilityRole="image"
      accessible
      accessibilityLabel={NEXO_LOGO_TITLE}
      source={WORDMARK}
      style={{ width, height }}
      resizeMode="contain"
    />
  );
}
