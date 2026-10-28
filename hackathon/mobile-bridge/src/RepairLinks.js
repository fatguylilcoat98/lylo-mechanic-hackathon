/*
 * LYLO Mechanic hackathon v0.4.6: "Watch how" (YouTube search) + "Find nearest store" + store
 * price buttons for the baseline Code detail screen, using the remembered vehicle (lylo.vehicle).
 */
import React, { useEffect, useState } from 'react';
import { forCodeDetail } from './priceLinks';
import { PriceButtons } from './PriceButtons';
import { loadVehicle } from './vin';

let defaultStorage = null;
try { defaultStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { defaultStorage = null; }

export default function RepairLinks({ result, storage, open }) {
  const store = storage === undefined ? defaultStorage : storage;
  const [vehicle, setVehicle] = useState(null);
  useEffect(() => { let live = true; loadVehicle(store).then((v) => { if (live) setVehicle(v); }); return () => { live = false; }; }, [store]);
  const p = result ? forCodeDetail(result, vehicle) : null;
  return p ? <PriceButtons p={p} open={open} /> : null;
}
