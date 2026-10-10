use super::LightingParams;
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/utils/scene-lighting/__tests__/relighting-wire-cases.json"
    )))
    .unwrap()
}

// JSON 的 1 和 1.0 表达相同数值；不能把序列化表示差异误算成 wire 行为失败。
fn assert_same_json(actual: &Value, expected: &Value) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64()),
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len());
            for (key, value) in b {
                assert_same_json(a.get(key).expect("canonical field missing"), value);
            }
        },
        _ => assert_eq!(actual, expected),
    }
}

#[test]
fn relighting_empty_block_materializes_factory_defaults() {
    let input = fixture();
    let row = input["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == "empty-block-defaults")
        .unwrap();
    let lighting: LightingParams = serde_json::from_value(row["input"].clone()).unwrap();
    let serialized = serde_json::to_value(lighting).unwrap();
    let block = serialized
        .get("relighting")
        .expect("V2 wire must retain an explicitly supplied relighting block");
    assert_same_json(block, &input["factory"]);
}

#[test]
fn relighting_runtime_canonicalizes_shared_accepted_wire_cases() {
    let input = fixture();
    let mut checked = 0;
    for row in input["cases"].as_array().unwrap() {
        if row["runtime_wire_accepted"] != true {
            continue;
        }
        let lighting: LightingParams = serde_json::from_value(row["input"].clone()).unwrap();
        let serialized = serde_json::to_value(lighting).unwrap();
        if row["expected_relighting"].is_null() {
            assert!(serialized.get("relighting").is_none());
        } else {
            assert_same_json(&serialized["relighting"], &row["expected_relighting"]);
        }
        checked += 1;
    }
    assert_eq!(checked, 11);
}

#[test]
fn relighting_typed_wire_rejects_arrays_and_wrong_scalar_shapes() {
    let input = fixture();
    let mut checked = 0;
    for row in input["cases"].as_array().unwrap() {
        if row["runtime_wire_accepted"] != false {
            continue;
        }
        assert!(
            serde_json::from_value::<LightingParams>(row["input"].clone()).is_err(),
            "typed wire must reject {}",
            row["id"]
        );
        checked += 1;
    }
    assert_eq!(checked, 3);
    for field in ["ambient", "point_light"] {
        let mut value = serde_json::json!({"schema_version": 2, "relighting": {}});
        value["relighting"][field] = serde_json::json!([]);
        assert!(serde_json::from_value::<LightingParams>(value).is_err());
    }
}

#[test]
fn relighting_rejects_future_or_malformed_explicit_schema_without_legacy_fallback() {
    for version in [
        serde_json::json!(3),
        serde_json::json!(u32::MAX),
        serde_json::json!(-1),
        serde_json::json!(2.5),
        serde_json::json!("2"),
        serde_json::json!(null),
        serde_json::json!(true),
    ] {
        let value = serde_json::json!({"schema_version": version, "relighting": {"enabled": true}});
        assert!(
            serde_json::from_value::<LightingParams>(value).is_err(),
            "unsupported version must not silently migrate"
        );
    }
}

#[test]
fn relighting_legacy_versions_do_not_manufacture_the_optional_block() {
    for value in [
        serde_json::json!({}),
        serde_json::json!({"schema_version": 0, "brightness": 1.2}),
        serde_json::json!({"schema_version": 1, "character": {"brightness": 1.2}}),
        serde_json::json!({"schema_version": 2}),
    ] {
        let lighting: LightingParams = serde_json::from_value(value).unwrap();
        assert!(lighting.relighting.is_none());
        assert!(
            serde_json::to_value(lighting)
                .unwrap()
                .get("relighting")
                .is_none()
        );
    }
}

#[test]
fn relighting_in_memory_nonfinite_numbers_use_field_factory_defaults() {
    let mut lighting = LightingParams {
        relighting: Some(Default::default()),
        ..LightingParams::default()
    };
    let block = lighting.relighting.as_mut().unwrap();
    block.ambient.intensity = f64::NAN;
    block.point_light.x = f64::NAN;
    block.point_light.y = f64::INFINITY;
    block.point_light.radius = f64::NEG_INFINITY;
    block.point_light.softness = f64::NAN;
    block.point_light.intensity = f64::INFINITY;
    lighting.normalize();
    assert_same_json(
        &serde_json::to_value(lighting).unwrap()["relighting"],
        &fixture()["factory"],
    );
}

#[test]
fn relighting_opaque_colour_trimming_matches_ecmascript_not_legacy_colour_rules() {
    let input = serde_json::json!({
        "schema_version": 2,
        "relighting": {"ambient": {"color": "\u{feff}#AABBCC\u{feff}"}, "point_light": {"color": "#123456\u{0085}"}},
        "character": {"glow_color": "#ABCD"}
    });
    let lighting: LightingParams = serde_json::from_value(input).unwrap();
    let block = lighting.relighting.as_ref().unwrap();
    assert_eq!(block.ambient.color, "#aabbcc");
    assert_eq!(block.point_light.color, "#fff1d2");
    assert_eq!(lighting.character.glow_color, "#abcd");
}
