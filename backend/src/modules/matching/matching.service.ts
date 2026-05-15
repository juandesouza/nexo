import { Injectable } from "@nestjs/common";

type DriverCandidate = {
  id: string;
  lat: number;
  lng: number;
  rating: number;
};

@Injectable()
export class MatchingService {
  private readonly mockDrivers: DriverCandidate[] = [
    { id: "driver-1", lat: -23.55, lng: -46.63, rating: 4.9 },
    { id: "driver-2", lat: -23.57, lng: -46.64, rating: 4.8 },
    { id: "driver-3", lat: -23.54, lng: -46.62, rating: 4.7 }
  ];

  async findBestDriver(origin: { lat: number; lng: number }): Promise<DriverCandidate | null> {
    const sorted = this.mockDrivers
      .map((driver) => ({
        driver,
        score: this.distance(origin, driver) - driver.rating * 0.02
      }))
      .sort((a, b) => a.score - b.score);

    return sorted[0]?.driver ?? null;
  }

  private distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const dx = a.lat - b.lat;
    const dy = a.lng - b.lng;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
