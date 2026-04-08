
import requests
from bs4 import BeautifulSoup
import urllib.parse

def search_harness_agent_info():
    # 搜索关键词
    query = "harness agent coordination management multi-agent system design implementation"
    
    # 使用DuckDuckGo搜索（隐私友好且无API限制）
    search_url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
    
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        
        response = requests.get(search_url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 提取搜索结果
        results = []
        for result in soup.find_all('div', class_='result'):
            try:
                title = result.find('a', class_='result__a').text
                url = result.find('a', class_='result__a')['href']
                snippet = result.find('a', class_='result__snippet').text
                results.append({
                    'title': title,
                    'url': url,
                    'snippet': snippet
                })
            except:
                continue
        
        return results
        
    except Exception as e:
        print(f"搜索失败: {e}")
        return []

def search_harness_agent_case_studies():
    # 搜索harness agent的设计案例
    query = "harness agent design patterns case studies multi-agent system examples"
    
    search_url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
    
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        
        response = requests.get(search_url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 提取搜索结果
        results = []
        for result in soup.find_all('div', class_='result'):
            try:
                title = result.find('a', class_='result__a').text
                url = result.find('a', class_='result__a')['href']
                snippet = result.find('a', class_='result__snippet').text
                results.append({
                    'title': title,
                    'url': url,
                    'snippet': snippet
                })
            except:
                continue
        
        return results
        
    except Exception as e:
        print(f"案例搜索失败: {e}")
        return []

def main():
    print("=== 搜索harness agent设计原理和实现方式 ===")
    print()
    
    print("1. 基础信息搜索结果：")
    print("-" * 50)
    basic_info = search_harness_agent_info()
    for i, result in enumerate(basic_info[:10], 1):
        print(f"{i}. {result['title']}")
        print(f"   URL: {result['url']}")
        print(f"   摘要: {result['snippet']}")
        print()
    
    print("\n2. 设计案例和最佳实践搜索结果：")
    print("-" * 50)
    case_studies = search_harness_agent_case_studies()
    for i, result in enumerate(case_studies[:10], 1):
        print(f"{i}. {result['title']}")
        print(f"   URL: {result['url']}")
        print(f"   摘要: {result['snippet']}")
        print()

if __name__ == "__main__":
    main()
