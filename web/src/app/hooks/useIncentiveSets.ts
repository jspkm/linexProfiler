import { useState, useCallback } from "react";
import { CLOUD_FUNCTION_URL } from "@/lib/api";
import type { ApiRecord } from "@/lib/types";

export function useIncentiveSets() {
  const [incentiveSets, setIncentiveSets] = useState<ApiRecord[]>([]);
  const [selectedIncentiveSetVersion, setSelectedIncentiveSetVersion] = useState("");
  const [selectedIncentiveSetDetail, setSelectedIncentiveSetDetail] = useState<ApiRecord | null>(null);
  const [incentiveSetDetailLoading, setIncentiveSetDetailLoading] = useState(false);

  const fetchIncentiveSets = useCallback(async () => {
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/list_incentive_sets`);
      if (res.ok) {
        const data = await res.json();
        const sets = data.incentive_sets || [];
        setIncentiveSets(sets);
        const defaultSet = sets.find((s: ApiRecord) => s.is_default);
        if (defaultSet) {
          setSelectedIncentiveSetVersion(defaultSet.version);
        } else if (sets.length > 0) {
          setSelectedIncentiveSetVersion((prev) => prev || sets[0].version);
        }
      }
    } catch { /* silent */ }
  }, []);

  const loadIncentiveSetDetail = useCallback(async (version?: string) => {
    setIncentiveSetDetailLoading(true);
    try {
      const url = version
        ? `${CLOUD_FUNCTION_URL}/incentive_set/${version}`
        : `${CLOUD_FUNCTION_URL}/incentive_set`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSelectedIncentiveSetDetail(data);
      }
    } catch { /* silent */ }
    finally { setIncentiveSetDetailLoading(false); }
  }, []);

  return {
    incentiveSets, fetchIncentiveSets,
    selectedIncentiveSetVersion, setSelectedIncentiveSetVersion,
    selectedIncentiveSetDetail, setSelectedIncentiveSetDetail,
    incentiveSetDetailLoading, loadIncentiveSetDetail,
  };
}
