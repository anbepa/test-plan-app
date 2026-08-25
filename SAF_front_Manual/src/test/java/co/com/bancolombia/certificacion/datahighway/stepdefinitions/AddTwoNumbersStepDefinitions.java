package co.com.bancolombia.certificacion.datahighway.stepdefinitions;

import io.cucumber.java.Before;
import io.cucumber.java.Scenario;
import io.cucumber.java.en.Given;
import net.serenitybdd.core.Serenity;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import static org.junit.Assert.fail;

public class AddTwoNumbersStepDefinitions {
    private Scenario scenario;
    private int stepIndex = 0;
    private static Map<String, Map<String, Object>> results;
    private static boolean loaded = false;

    private static final Path RESULTS_JSON = Paths.get("ci", "out", "manual-results.json");
    private static final Path EVIDENCES_DIR = Paths.get("evidences");

    @Before
    public void getScenario(Scenario scenario) {
        this.scenario = scenario;
        this.stepIndex = 0;

        loadResultsOnce();
    }

    private static synchronized void loadResultsOnce() {
        if (loaded) return;
        loaded = true;

        try {
            if (!Files.exists(RESULTS_JSON)) {
                System.err.println("[ManualResults] No se encontro " + RESULTS_JSON.toAbsolutePath());
                results = new HashMap<>();
                return;
            }
            ObjectMapper mapper = new ObjectMapper();
            results = mapper.readValue(RESULTS_JSON.toFile(),
                new TypeReference<Map<String, Map<String, Object>>>() {});
            System.out.println("[ManualResults] Cargados " + results.size() + " escenarios desde " + RESULTS_JSON);
        } catch (Exception e) {
            System.err.println("[ManualResults] Error al cargar " + RESULTS_JSON + ": " + e.getMessage());
            results = new HashMap<>();
        }
    }

    @Given("^(.*)$")
    public void handleAnyStep(String step) throws IOException {
        String scenarioName = scenario.getName();
        String status = "pending";
        List<String> evidenceNames = new ArrayList<>();

        if (results != null && !results.isEmpty()) {
            Map<String, Object> scenarioResults = results.get(scenarioName);
            if (scenarioResults == null) {
                System.err.println("[ManualResults] Escenario \"" + scenarioName
                    + "\" no encontrado en manual-results.json. Claves disponibles: " + results.keySet());
            }

            if (scenarioResults != null) {
                Object stepsObj = scenarioResults.get("steps");
                if (stepsObj instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> steps = (Map<String, Object>) stepsObj;
                    Object stepResult = steps.get(String.valueOf(stepIndex));
                    if (stepResult instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> sr = (Map<String, Object>) stepResult;
                        status = sr.get("status") != null ? sr.get("status").toString() : "pending";
                        @SuppressWarnings("unchecked")
                        List<String> evs = (List<String>) sr.get("evidences");
                        if (evs != null) evidenceNames = evs;
                    }
                }
            }
        }

        attachEvidence(evidenceNames);
        stepIndex++;

        if ("failed".equals(status)) {
            fail("El paso fue marcado como fallido por el tester");
        }
    }

    private void attachEvidence(List<String> names) {
        if (names == null || names.isEmpty()) return;

        for (String name : names) {
            Path evPath = EVIDENCES_DIR.resolve(name);
            if (Files.exists(evPath)) {
                try {
                    Serenity.recordReportData()
                        .asEvidence()
                        .withTitle("Evidencia de ejecución")
                        .downloadable()
                        .fromFile(evPath);
                } catch (Exception e) {
                    System.err.println("[ManualResults] Error adjuntando evidencia " + name + ": " + e.getMessage());
                }
            } else {
                System.err.println("[ManualResults] Evidencia no encontrada: " + evPath.toAbsolutePath());
            }
        }
    }
}
