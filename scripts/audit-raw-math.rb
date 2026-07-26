require "nokogiri"

root = File.expand_path("..", __dir__)
files = if ARGV.empty?
  [
    "ML - HSTU/index.html",
    "ML - Semantic IDs/index.html",
    "ML - Multimodal MMoE/index.html",
    "ML - OneRec/index.html",
    "ML - Self Attention and Multi-Head Attention/index.html",
    "RL - PPO and GRPO/index.html"
  ].map { |file| File.join(root, file) }
else
  ARGV.map { |file| File.expand_path(file) }
end

failed = false
files.each do |file|
  document = Nokogiri::HTML(File.read(file))
  findings = []
  nodes = document.xpath("//text()[not(ancestor::script) and not(ancestor::style) and not(ancestor::pre) and not(ancestor::code)]")
  nodes.each do |node|
    text = node.text.gsub(/\\\[.*?\\\]/m, "").gsub(/\\\(.*?\\\)/m, "")
    next unless text.match?(/\\[A-Za-z]+|[A-Za-z][A-Za-z0-9]*_\{|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]|[A-Za-z][A-Za-z0-9]*\^\{/)
    findings << [node.line, text.strip.gsub(/\s+/, " ")]
  end

  relative = file.delete_prefix(root + "/")
  puts relative
  if findings.empty?
    puts "  no raw TeX-like text"
  else
    failed = true
    findings.each { |line, text| puts "  line #{line}: #{text}" }
  end
end

exit(failed ? 1 : 0)
