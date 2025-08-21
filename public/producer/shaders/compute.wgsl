// shaders/compute.wgsl

// Define your types for uniforms/storage buffers
struct FieldLayout {
    field_x: f32, field_y: f32, field_w: f32, field_h: f32,
    block_size_x: f32, block_size_y: f32,
    grid_cols: f32, grid_rows: f32,
};

// Assuming 4 reference colors (0 is background, 1-3 are actual block colors)
struct ReferenceColors {
    colors: array<vec4<f32>, 4>, // Example, adjust size based on referenceColorsData.length / 4
};

// Bindings match JavaScript setup
@group(0) @binding(0) var outputTexture: texture_storage_2d<rgba8unorm, read>; // This will now refer to computeInputTexture
@group(0) @binding(1) var<uniform> refColors: ReferenceColors;
@group(0) @binding(2) var<storage, read_write> blockTypes: array<u32>; // The one compute writes to
@group(0) @binding(3) var<uniform> fieldLayout: FieldLayout;

// Helper function for luma
fn luma(color: vec4<f32>) -> f32 {
    return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
}

// Helper for RGB to XYZ (needed for RGB to Lab)
fn rgb_to_xyz(rgb: vec3<f32>) -> vec3<f32> {
    // This conversion assumes sRGB input. If your textures are linear, you might need to linearize them first,
    // or use a linear RGB to XYZ matrix. rgba8unorm typically means linear, so this formula might need adjusting
    // for actual linear-to-sRGB conversion on the values or a linear-to-XYZ matrix.
    // For simplicity, let's assume direct linear-to-XYZ that matches your JS logic if it works for your data.
    // A common sRGB to linear conversion: if val <= 0.04045 then val / 12.92 else pow((val + 0.055) / 1.055, 2.4)
    // And then linear RGB to XYZ matrix.
    // For initial testing, let's use a simplified common matrix if you don't have exact one.
    // This is a simplified, direct linear RGB to XYZ example. Be precise with this!
    // Exact values for D65 white point (common):
    let r_lin = select(rgb.r / 12.92, pow((rgb.r + 0.055) / 1.055, 2.4), rgb.r <= 0.04045);
    let g_lin = select(rgb.g / 12.92, pow((rgb.g + 0.055) / 1.055, 2.4), rgb.g <= 0.04045);
    let b_lin = select(rgb.b / 12.92, pow((rgb.b + 0.055) / 1.055, 2.4), rgb.b <= 0.04045);

    let x = r_lin * 0.4124564 + g_lin * 0.3575761 + b_lin * 0.1804375;
    let y = r_lin * 0.2126729 + g_lin * 0.7151522 + b_lin * 0.0721750;
    let z = r_lin * 0.0193339 + g_lin * 0.1191920 + b_lin * 0.9503041;
    return vec3<f32>(x, y, z);
}

// Helper for XYZ to Lab (D65 white point)
fn xyz_to_lab(xyz: vec3<f32>) -> vec3<f32> {
    let ref_x = 0.95047; // D65 White point
    let ref_y = 1.00000;
    let ref_z = 1.08883;

    var fx = xyz.x / ref_x;
    var fy = xyz.y / ref_y;
    var fz = xyz.z / ref_z;

    let delta = 6.0 / 29.0;
    fx = select(pow(fx, 1.0/3.0), (fx * 7.787) + (16.0 / 116.0), fx <= pow(delta, 3.0));
    fy = select(pow(fy, 1.0/3.0), (fy * 7.787) + (16.0 / 116.0), fy <= pow(delta, 3.0));
    fz = select(pow(fz, 1.0/3.0), (fz * 7.787) + (16.0 / 116.0), fz <= pow(delta, 3.0));

    let L = (116.0 * fy) - 16.0;
    let a = 500.0 * (fx - fy);
    let b = 200.0 * (fy - fz);

    return vec3<f32>(L, a, b);
}

// Full RGB to Lab
fn rgb_to_lab(rgb: vec3<f32>) -> vec3<f32> {
    return xyz_to_lab(rgb_to_xyz(rgb));
}

// Main compute shader entry point
@compute @workgroup_size(1, 1, 1) // One thread per block, workgroup size 1x1x1
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let block_col_idx = global_id.x; // 0-9
    let block_row_idx = global_id.y; // 0-19

    let block_index = u32(block_row_idx) * u32(fieldLayout.grid_cols) + u32(block_col_idx);
    if (block_index >= 200u) { return; } // Safety check

    // Calculate block's top-left pixel in outputTexture
    let field_pixel_x = u32(fieldLayout.field_x);
    let field_pixel_y = u32(fieldLayout.field_y);
    let block_top_left_x = field_pixel_x + u32(block_col_idx) * u32(fieldLayout.block_size_x);
    let block_top_left_y = field_pixel_y + u32(block_row_idx) * u32(fieldLayout.block_size_y);

    // --- 1. Shine Detection ---
    var has_shine = false;
    const shine_pixels = array<vec2<u32>, 3>(
        vec2<u32>(1u, 1u), // (1,1) relative to block
        vec2<u32>(1u, 2u), // (1,2)
        vec2<u32>(2u, 1u)  // (2,1)
    );

    for (var i = 0u; i < 3u; i++) {
        let pixel_coord = vec2<u32>(block_top_left_x + shine_pixels[i].x,
                                   block_top_left_y + shine_pixels[i].y);
        let color = textureLoad(outputTexture, pixel_coord);
        if (luma(color) > 0.3) {
            has_shine = true;
            break; // Found shine, no need to check other pixels
        }
    }

    // --- 2. Representative Color Calculation (RGB RMS Average) ---
    var r_sum_sq = 0.0;
    var g_sum_sq = 0.0;
    var b_sum_sq = 0.0;
    let pix_refs_count = 4u; // Number of pixels to average

    const color_avg_pixels = array<vec2<u32>, 4>(
        vec2<u32>(2u, 4u), // (2,4) relative to block
        vec2<u32>(3u, 3u), // (3,3)
        vec2<u32>(4u, 4u), // (4,4)
        vec2<u32>(4u, 2u)  // (4,2)
    );

    for (var i = 0u; i < pix_refs_count; i++) {
        let pixel_coord = vec2<u32>(block_top_left_x + color_avg_pixels[i].x,
                                   block_top_left_y + color_avg_pixels[i].y);
        let color = textureLoad(outputTexture, pixel_coord);
        r_sum_sq += color.r * color.r;
        g_sum_sq += color.g * color.g;
        b_sum_sq += color.b * color.b;
    }

    let avg_r = sqrt(r_sum_sq / f32(pix_refs_count));
    let avg_g = sqrt(g_sum_sq / f32(pix_refs_count));
    let avg_b = sqrt(b_sum_sq / f32(pix_refs_count));
    let representative_rgb = vec3<f32>(avg_r, avg_g, avg_b);


    // --- 3. Block Type Assignment ---
    var block_type = 0u; // Default to 0 (no shine)

    if (has_shine) {
        let representative_lab = rgb_to_lab(representative_rgb);

        var min_dist_sq = 1e9; // Large number for initial minimum distance squared
        var closest_index = 0u;

        // Iterate through reference colors 1 to 3 (index 0 is black)
        for (var i = 1u; i < 4u; i++) {
            let ref_rgb = refColors.colors[i].rgb;
            let ref_lab = rgb_to_lab(ref_rgb);

            let dist_sq = distance_squared(representative_lab, ref_lab); // Implement distance_squared
            if (dist_sq < min_dist_sq) {
                min_dist_sq = dist_sq;
                closest_index = i;
            }
        }
        block_type = closest_index; // This will be 1, 2, or 3
    }

    // Store the result
    blockTypes[block_index] = block_type;
}

// Helper function for Euclidean distance squared
fn distance_squared(a: vec3<f32>, b: vec3<f32>) -> f32 {
    let diff = a - b;
    return dot(diff, diff);
}