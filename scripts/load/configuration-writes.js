import http from "k6/http";
import { check } from "k6";

const baseUrl = (__ENV.BASE_URL ?? "").replace(/\/$/, "");
const vehicleId = __ENV.VEHICLE_ID;
const gradeId = __ENV.GRADE_ID;
const modelYear = Number(__ENV.MODEL_YEAR);

if (!baseUrl || !vehicleId || !gradeId || !Number.isInteger(modelYear)) {
  throw new Error("Set BASE_URL, VEHICLE_ID, GRADE_ID, and integer MODEL_YEAR before running this test.");
}

export const options = {
  scenarios: {
    configuration_writes: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE ?? 100),
      timeUnit: "1s",
      duration: __ENV.DURATION ?? "30s",
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS ?? 50),
      maxVUs: Number(__ENV.MAX_VUS ?? 200),
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(99)<250"],
  },
};

export default function () {
  const headers = { "Content-Type": "application/json" };
  if (__ENV.WRITE_API_KEY) headers["X-API-Key"] = __ENV.WRITE_API_KEY;

  const response = http.post(
    `${baseUrl}/api/v1/configurations`,
    JSON.stringify({ vehicleId, modelYear, gradeId, selections: {} }),
    { headers },
  );

  check(response, {
    "created configuration": (result) => result.status === 201,
    "returns request id": (result) => Boolean(result.headers["X-Request-Id"]),
  });
}
